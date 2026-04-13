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

const getColorByName = (name: string) => {
  const lowerName = name.toLowerCase();
  
  // Specific item colors
  if (lowerName.includes('silica sand')) return '#E2C799'; // Sand color
  
  if (lowerName.includes('red')) return '#EF4444';
  if (lowerName.includes('green')) return '#10B981';
  
  // Sky Blue vs Deep Blue
  if (lowerName.includes('sky blue')) return '#38BDF8'; 
  if (lowerName.includes('blue')) return '#2563EB';
  
  if (lowerName.includes('yellow')) return '#F59E0B';
  if (lowerName.includes('orange')) return '#F97316';
  
  // Differentiating Light and Dark Grey - Made Light Grey slightly darker for visibility
  if (lowerName.includes('light grey') || lowerName.includes('light gray')) return '#D1D5DB';
  if (lowerName.includes('dark grey') || lowerName.includes('dark gray')) return '#1E293B';
  if (lowerName.includes('grey') || lowerName.includes('gray')) return '#64748B';
  
  if (lowerName.includes('black')) return '#0F172A';
  if (lowerName.includes('white')) return '#FFFFFF';
  if (lowerName.includes('pink')) return '#EC4899';
  if (lowerName.includes('purple')) return '#8B5CF6';
  return null;
};

const TARGET_KEYWORDS = ["tile", "kerb", "corner", "raw material"];

interface SortableChartProps {
  cat: Category;
  items: Item[];
  transactions: Transaction[];
  selectedDate: string;
  index: number;
}

function SortableChart({ cat, items, transactions, selectedDate, index }: SortableChartProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: cat.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 0,
    opacity: isDragging ? 0.5 : 1,
  };

  const dayStart = startOfDay(parseISO(selectedDate)).getTime();
  const dayEnd = endOfDay(parseISO(selectedDate)).getTime();

  const catItems = items
    .filter(item => item.categoryId === cat.id)
    .map(item => {
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

      return {
        name: item.name,
        stock: closingStock,
        openingStock,
        stockIn,
        stockOut,
        unit: item.unit || '',
        stockLabel: `${closingStock} ${item.unit || ''}`
      };
    })
    .sort((a, b) => b.stock - a.stock);

  if (catItems.length === 0) return null;

  // Determine width and height based on category name
  const name = cat.name.toLowerCase();
  const isTile = name.includes('tile');
  const isRawMaterial = name.includes('raw material');
  const isKerbOrCorner = name.includes('kerb') || name.includes('corner');
  
  const widthClass = isRawMaterial 
    ? "lg:col-span-12" 
    : (isTile ? "lg:col-span-6" : (isKerbOrCorner ? "lg:col-span-4" : "lg:col-span-4"));
    
  const chartHeight = isRawMaterial 
    ? "h-[380px]" 
    : (isTile ? "h-[340px]" : "h-[300px]");

  return (
    <div 
      id={`stock-chart-container-${cat.id}`}
      ref={setNodeRef} 
      style={style}
      className={`bg-white p-6 rounded-[32px] shadow-sm border border-slate-100 flex flex-col h-full ${widthClass} col-span-12 transition-all hover:shadow-xl hover:shadow-slate-200/50 hover:-translate-y-1`}
    >
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button 
            {...attributes} 
            {...listeners}
            className="p-2 hover:bg-slate-50 rounded-lg cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 transition-colors"
          >
            <GripVertical size={22} />
          </button>
          <div>
            <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight leading-none mb-1.5">{cat.name}</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Inventory Level</p>
          </div>
        </div>
        <div className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center text-slate-400">
          <Package size={20} />
        </div>
      </div>
      
      <div id={`stock-chart-wrapper-${cat.id}`} className={`${chartHeight} w-full mt-auto`}>
        <ResponsiveContainer id={`stock-rc-${cat.id}`} width="100%" height="100%">
          <BarChart data={catItems} margin={{ top: 35, right: 10, left: -20, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F8FAFC" />
            <XAxis 
              dataKey="name" 
              axisLine={false} 
              tickLine={false} 
              tick={{fill: '#475569', fontSize: 11, fontWeight: 800}}
              angle={-45}
              textAnchor="end"
              interval={0}
              height={70}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{fill: '#94A3B8', fontSize: 11, fontWeight: 700}} 
            />
            <Tooltip 
              cursor={{fill: '#F8FAFC', radius: 8}}
              contentStyle={{ 
                borderRadius: '16px', 
                border: 'none', 
                boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)',
                fontSize: '12px',
                fontWeight: '800',
                padding: '14px'
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
            <Bar dataKey="stock" radius={[8, 8, 0, 0]} barSize={isTile ? 45 : 35}>
              {catItems.map((entry, i) => {
                const color = getColorByName(entry.name) || COLORS[index % COLORS.length];
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
                style={{ fill: '#1E293B', fontSize: 13, fontWeight: 900 }}
                offset={10}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function StockReport() {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderedCategoryIds, setOrderedCategoryIds] = useState<string[]>([]);
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
      
      // Always calculate the default order based on weights
      const filtered = cats.filter(cat => 
        TARGET_KEYWORDS.some(keyword => cat.name.toLowerCase().includes(keyword))
      );
      
      const sorted = [...filtered].sort((a, b) => {
        const aName = a.name.toLowerCase();
        const bName = b.name.toLowerCase();
        
        const getWeight = (name: string) => {
          const n = name.toLowerCase();
          if (n.includes('pp tile')) return 1;
          if (n.includes('soft tile')) return 2;
          if (n.includes('kerb') && n.includes('male')) return 3;
          if (n.includes('kerb') && n.includes('female')) return 4;
          if (n.includes('corner')) return 5;
          if (n.includes('raw material')) return 6;
          return 10;
        };
        
        return getWeight(aName) - getWeight(bName);
      });
      
      // Only set if not already set or if explicitly resetting
      setOrderedCategoryIds(prev => prev.length === 0 ? sorted.map(c => c.id) : prev);
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
  }, [orderedCategoryIds.length]);

  const filteredCategories = useMemo(() => {
    const catsMap = new Map(categories.map(c => [c.id, c]));
    return orderedCategoryIds
      .map(id => catsMap.get(id))
      .filter((c): c is Category => !!c && TARGET_KEYWORDS.some(keyword => c.name.toLowerCase().includes(keyword)));
  }, [categories, orderedCategoryIds]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      setOrderedCategoryIds((items) => {
        const oldIndex = items.indexOf(active.id as string);
        const newIndex = items.indexOf(over.id as string);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const resetLayout = () => {
    const filtered = categories.filter(cat => 
      TARGET_KEYWORDS.some(keyword => cat.name.toLowerCase().includes(keyword))
    );
    const sorted = [...filtered].sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const getWeight = (name: string) => {
        const n = name.toLowerCase();
        if (n.includes('pp tile')) return 1;
        if (n.includes('soft tile')) return 2;
        if (n.includes('kerb') && n.includes('male')) return 3;
        if (n.includes('kerb') && n.includes('female')) return 4;
        if (n.includes('corner')) return 5;
        if (n.includes('raw material')) return 6;
        return 10;
      };
      return getWeight(aName) - getWeight(bName);
    });
    setOrderedCategoryIds(sorted.map(c => c.id));
  };

  const exportToExcel = () => {
    const data: any[] = [];
    filteredCategories.forEach(cat => {
      const catItems = items.filter(item => item.categoryId === cat.id);
      catItems.forEach(item => {
        data.push({
          'Category': cat.name,
          'Product Name': item.name,
          'Current Stock': item.currentStock,
          'Unit': item.unit
        });
      });
    });
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Detailed Stock Report");
    XLSX.writeFile(wb, `Detailed_Stock_Report_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
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
          <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Stock Report</h1>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Interactive inventory dashboard</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button 
            id="reset-layout-btn"
            onClick={resetLayout}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-colors text-xs font-black text-slate-700 uppercase tracking-widest"
          >
            <RotateCcw size={16} className="text-slate-500" />
            Reset Layout
          </button>
          <button 
            id="export-report-btn"
            onClick={exportToExcel}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center gap-2 hover:bg-slate-50 transition-colors text-xs font-black text-slate-700 uppercase tracking-widest"
          >
            <Download size={16} className="text-blue-600" />
            Export Detailed Report
          </button>
          <div id="date-selector-wrapper" className="px-4 py-2 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center gap-3">
            <Calendar size={16} className="text-blue-600" />
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Select Date:</span>
              <input 
                id="stock-report-date-input"
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
          items={orderedCategoryIds}
          strategy={rectSortingStrategy}
        >
          <div className="grid grid-cols-12 gap-6">
            {filteredCategories.map((cat, index) => (
              <SortableChart 
                key={cat.id} 
                cat={cat} 
                items={items} 
                transactions={transactions}
                selectedDate={selectedDate}
                index={index} 
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
