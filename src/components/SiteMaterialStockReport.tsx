import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Cell,
  LabelList
} from 'recharts';
import { 
  Package, 
  Calendar, 
  Download,
  GripVertical,
  RotateCcw
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { Item, Category, Transaction } from '../types';
import { format, startOfDay, endOfDay, parseISO } from 'date-fns';
import * as XLSX from 'xlsx';
import {
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#14B8A6'];

const getColorByName = (name: string, shouldGroupColor: boolean) => {
  const lowerName = name.toLowerCase();
  
  // Specific item colors
  if (lowerName.includes('silica sand')) return '#E2C799'; // Sand color
  
  if (!shouldGroupColor) return null;
  if (lowerName.includes('red')) return '#EF4444';
  if (lowerName.includes('green')) return '#10B981';
  
  // Sky Blue vs Deep Blue
  if (lowerName.includes('sky blue')) return '#38BDF8'; 
  if (lowerName.includes('blue')) return '#2563EB';
  
  if (lowerName.includes('yellow')) return '#F59E0B';
  if (lowerName.includes('orange')) return '#F97316';
  
  // Differentiating Light and Dark Grey
  if (lowerName.includes('light grey') || lowerName.includes('light gray')) return '#D1D5DB';
  if (lowerName.includes('dark grey') || lowerName.includes('dark gray')) return '#1E293B';
  if (lowerName.includes('grey') || lowerName.includes('gray')) return '#64748B';
  
  if (lowerName.includes('black')) return '#0F172A';
  if (lowerName.includes('white')) return '#FFFFFF';
  if (lowerName.includes('pink')) return '#EC4899';
  if (lowerName.includes('purple')) return '#8B5CF6';
  return null;
};

const extractDisplayName = (name: string, shouldGroupColor: boolean) => {
  if (shouldGroupColor) {
    const colors = [
      'sky blue', 'light grey', 'light gray', 'dark grey', 'dark gray', 
      'red', 'green', 'blue', 'yellow', 'orange', 'grey', 'gray', 'black', 'white',
      'pink', 'purple'
    ];
    const lowerName = name.toLowerCase();
    
    for (const color of colors) {
      if (lowerName.includes(color)) {
        return color.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
      }
    }
  }
  
  // If no color grouping or no color found, clean up the name
  return name.replace(/^(EPDM|Acrylic|Nets|Poles)\s+(Full|Loose|Half)\s+/i, '').trim();
};

interface ChartGroup {
  id: string;
  name: string;
  keywords: string[];
  widthClass: string;
  chartHeight: string;
}

const GROUPS: ChartGroup[] = [
  { 
    id: 'group-epdm', 
    name: 'EPDM (Full & Loose)', 
    keywords: ['epdm full', 'epdm loose'], 
    widthClass: 'col-span-6',
    chartHeight: 'h-[400px]'
  },
  { 
    id: 'group-acrylic', 
    name: 'Acrylic (Full & Half)', 
    keywords: ['acrylic full', 'acrylic half'], 
    widthClass: 'col-span-6',
    chartHeight: 'h-[400px]'
  },
  { 
    id: 'group-poles', 
    name: 'Poles', 
    keywords: ['pole'], 
    widthClass: 'lg:col-span-4 col-span-6',
    chartHeight: 'h-[320px]'
  },
  { 
    id: 'group-nets', 
    name: 'Nets', 
    keywords: ['net'], 
    widthClass: 'lg:col-span-2 col-span-6',
    chartHeight: 'h-[320px]'
  }
];

interface SortableChartProps {
  group: ChartGroup;
  categories: Category[];
  items: Item[];
  transactions: Transaction[];
  selectedDate: string;
  index: number;
}

function SortableChart({ group, categories, items, transactions, selectedDate, index }: SortableChartProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: group.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 0,
    opacity: isDragging ? 0.5 : 1,
  };

  const dayStart = startOfDay(parseISO(selectedDate)).getTime();
  const dayEnd = endOfDay(parseISO(selectedDate)).getTime();

  // Find all categories that match this group's keywords
  const groupCategoryIds = categories
    .filter(cat => group.keywords.some(kw => cat.name.toLowerCase().includes(kw)))
    .map(cat => cat.id);

  // Group items by color/display name and sum stock
  const groupedData = items
    .filter(item => groupCategoryIds.includes(item.categoryId))
    .reduce((acc, item) => {
      const isColorGrouped = group.id.includes('epdm') || group.id.includes('acrylic');
      const displayName = extractDisplayName(item.name, isColorGrouped);
      
      const itemTxs = transactions.filter(tx => tx.itemId === item.id);
      
      // Calculate opening stock
      let openingStock = Number(item.initialStock || 0);
      itemTxs.forEach(tx => {
        if (new Date(tx.date).getTime() < dayStart) {
          if (tx.type === 'IN' || tx.type === 'FACTORY_IN') openingStock += tx.quantity;
          if (tx.type === 'OUT' || tx.type === 'SCHEDULED') openingStock -= tx.quantity;
        }
      });

      const stockIn = itemTxs
        .filter(tx => (tx.type === 'IN' || tx.type === 'FACTORY_IN') && new Date(tx.date).getTime() >= dayStart && new Date(tx.date).getTime() <= dayEnd)
        .reduce((acc, tx) => acc + tx.quantity, 0);
      const stockOut = itemTxs
        .filter(tx => (tx.type === 'OUT' || tx.type === 'SCHEDULED') && new Date(tx.date).getTime() >= dayStart && new Date(tx.date).getTime() <= dayEnd)
        .reduce((acc, tx) => acc + tx.quantity, 0);

      const closingStock = openingStock + stockIn - stockOut;

      if (!acc[displayName]) {
        acc[displayName] = { 
          name: displayName, 
          stock: 0, 
          openingStock: 0,
          stockIn: 0,
          stockOut: 0,
          unit: item.unit || '' 
        };
      }
      acc[displayName].stock += closingStock;
      acc[displayName].openingStock += openingStock;
      acc[displayName].stockIn += stockIn;
      acc[displayName].stockOut += stockOut;
      return acc;
    }, {} as Record<string, { name: string, stock: number, openingStock: number, stockIn: number, stockOut: number, unit: string }>);

  const catItems = Object.values(groupedData)
    .map(data => ({
      ...data,
      stockLabel: `${data.stock} ${data.unit}`
    }))
    .sort((a, b) => b.stock - a.stock);

  if (catItems.length === 0) return null;

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      className={`bg-white p-6 rounded-[32px] shadow-sm border border-slate-100 flex flex-col h-full ${group.widthClass} transition-all hover:shadow-xl hover:shadow-slate-200/50 hover:-translate-y-1`}
    >
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button 
            {...attributes} 
            {...listeners}
            className="p-2 hover:bg-slate-50 rounded-lg cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 transition-colors"
          >
            <GripVertical size={24} />
          </button>
          <div>
            <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight leading-none mb-1.5">{group.name}</h3>
            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">Inventory Level (Aggregated by Color)</p>
          </div>
        </div>
        <div className="w-12 h-12 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400">
          <Package size={24} />
        </div>
      </div>
      
      <div className={`${group.chartHeight} w-full mt-auto`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={catItems} margin={{ top: 35, right: 10, left: -10, bottom: 80 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F8FAFC" />
            <XAxis 
              dataKey="name" 
              axisLine={false} 
              tickLine={false} 
              tick={{fill: '#475569', fontSize: 12, fontWeight: 800}}
              angle={-45}
              textAnchor="end"
              interval={0}
              height={90}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{fill: '#94A3B8', fontSize: 12, fontWeight: 700}} 
            />
            <Tooltip 
              cursor={{fill: '#F8FAFC', radius: 8}}
              contentStyle={{ 
                borderRadius: '16px', 
                border: 'none', 
                boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
                fontSize: '12px',
                fontWeight: '800',
                padding: '16px'
              }}
              content={({ active, payload, label }) => {
                if (active && payload && payload.length) {
                  const data = payload[0].payload;
                  return (
                    <div className="bg-white p-4 rounded-2xl shadow-xl border border-slate-50 min-w-[180px]">
                      <p className="font-black text-slate-900 text-[10px] uppercase tracking-widest mb-3 border-b border-slate-50 pb-2">{label}</p>
                      <div className="space-y-2">
                        <div className="flex justify-between gap-4">
                          <span className="text-slate-500 text-[10px] font-bold uppercase">Opening:</span>
                          <span className="text-slate-900 text-[10px] font-black">{data.openingStock}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-emerald-500 text-[10px] font-bold uppercase">In:</span>
                          <span className="text-emerald-600 text-[10px] font-black">+{data.stockIn}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-rose-500 text-[10px] font-bold uppercase">Out:</span>
                          <span className="text-rose-600 text-[10px] font-black">-{data.stockOut}</span>
                        </div>
                        <div className="pt-2 mt-2 border-t border-slate-50 flex justify-between gap-4">
                          <span className="text-blue-600 text-[10px] font-black uppercase">Closing:</span>
                          <span className="text-blue-600 text-[10px] font-black">{data.stock} {data.unit}</span>
                        </div>
                      </div>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Bar dataKey="stock" radius={[10, 10, 0, 0]} barSize={catItems.length > 5 ? 40 : 60}>
              {catItems.map((entry, i) => {
                const isColorGrouped = group.id.includes('epdm') || group.id.includes('acrylic');
                const color = getColorByName(entry.name, isColorGrouped) || COLORS[index % COLORS.length];
                return (
                  <Cell 
                    key={`cell-${i}`} 
                    fill={color}
                    style={{ filter: 'drop-shadow(0 4px 6px rgb(0 0 0 / 0.05))' }}
                  />
                );
              })}
              <LabelList 
                dataKey="stockLabel" 
                position="top" 
                style={{ fill: '#1E293B', fontSize: 14, fontWeight: 900 }}
                offset={12}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function SiteMaterialStockReport() {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderedGroupIds, setOrderedGroupIds] = useState<string[]>(GROUPS.map(g => g.id));
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    const unsubItems = onSnapshot(collection(db, 'items'), (snap) => {
      setItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item)));
    });

    const unsubCategories = onSnapshot(collection(db, 'categories'), (snap) => {
      const cats = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category));
      setCategories(cats);
    });

    const unsubTransactions = onSnapshot(
      query(collection(db, 'transactions'), orderBy('date', 'desc')), 
      (snap) => {
        setTransactions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
      }
    );

    setLoading(false);
    return () => {
      unsubItems();
      unsubCategories();
      unsubTransactions();
    };
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      setOrderedGroupIds((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const resetLayout = () => {
    setOrderedGroupIds(GROUPS.map(g => g.id));
  };

  const exportToExcel = () => {
    const data: any[] = [];
    GROUPS.forEach(group => {
      const groupCategoryIds = categories
        .filter(cat => group.keywords.some(kw => cat.name.toLowerCase().includes(kw)))
        .map(cat => cat.id);
        
      const groupItems = items.filter(item => groupCategoryIds.includes(item.categoryId));
      groupItems.forEach(item => {
        data.push({
          'Group': group.name,
          'Product Name': item.name,
          'Current Stock': item.currentStock,
          'Unit': item.unit
        });
      });
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Site Material Stock Report");
    XLSX.writeFile(wb, `Site_Material_Stock_Report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="w-full max-w-[100vw] space-y-8 pb-20 md:pb-0 px-2 lg:px-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Site Material Stock Report</h1>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Interactive site material dashboard</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button 
            onClick={resetLayout}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-colors text-xs font-black text-slate-700 uppercase tracking-widest"
          >
            <RotateCcw size={16} className="text-slate-500" />
            Reset Layout
          </button>
          <button 
            onClick={exportToExcel}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-colors text-xs font-black text-slate-700 uppercase tracking-widest"
          >
            <Download size={16} className="text-blue-600" />
            Export Detailed Report
          </button>
          <div className="px-4 py-2 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center gap-3">
            <Calendar size={16} className="text-blue-600" />
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Select Date:</span>
              <input 
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent border-none p-0 text-xs font-black text-slate-700 focus:ring-0 outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      <DndContext 
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext 
          items={orderedGroupIds}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-6 gap-6">
            {orderedGroupIds.map((groupId, index) => {
              const group = GROUPS.find(g => g.id === groupId);
              if (!group) return null;
              return (
                <SortableChart 
                  key={group.id} 
                  group={group}
                  categories={categories}
                  items={items} 
                  transactions={transactions}
                  selectedDate={selectedDate}
                  index={index} 
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
