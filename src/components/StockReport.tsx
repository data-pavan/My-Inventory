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
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Item, Category } from '../types';
import { format } from 'date-fns';
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
  if (lowerName.includes('red')) return '#EF4444';
  if (lowerName.includes('green')) return '#10B981';
  if (lowerName.includes('blue')) return '#2563EB';
  if (lowerName.includes('yellow')) return '#F59E0B';
  if (lowerName.includes('orange')) return '#F97316';
  if (lowerName.includes('grey') || lowerName.includes('gray')) return '#64748B';
  if (lowerName.includes('black')) return '#0F172A';
  if (lowerName.includes('white')) return '#E2E8F0';
  return null;
};

const TARGET_KEYWORDS = ["pp tiles", "soft tiles", "kerb", "corner"];

interface SortableChartProps {
  cat: Category;
  items: Item[];
  index: number;
}

function SortableChart({ cat, items, index }: SortableChartProps) {
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

  const catItems = items
    .filter(item => item.categoryId === cat.id)
    .map(item => ({
      name: item.name,
      stock: item.currentStock
    }))
    .sort((a, b) => b.stock - a.stock);

  if (catItems.length === 0) return null;

  // Determine width based on category name for the initial "beside" and "one row" requirement
  const isTile = cat.name.toLowerCase().includes('tile');
  const widthClass = isTile ? "lg:col-span-3" : "lg:col-span-2";

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      className={`bg-white p-5 rounded-3xl shadow-sm border border-slate-100 flex flex-col h-full ${widthClass} col-span-6`}
    >
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button 
            {...attributes} 
            {...listeners}
            className="p-1 hover:bg-slate-100 rounded cursor-grab active:cursor-grabbing text-slate-400"
          >
            <GripVertical size={20} />
          </button>
          <div>
            <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">{cat.name}</h3>
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Current Inventory</p>
          </div>
        </div>
        <div className="w-8 h-8 rounded-xl bg-slate-50 flex items-center justify-center text-blue-600">
          <Package size={16} />
        </div>
      </div>
      
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={catItems} margin={{ top: 30, right: 10, left: 0, bottom: 60 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
            <XAxis 
              dataKey="name" 
              axisLine={false} 
              tickLine={false} 
              tick={{fill: '#64748B', fontSize: 9, fontWeight: 700}}
              angle={-45}
              textAnchor="end"
              interval={0}
            />
            <YAxis 
              axisLine={false} 
              tickLine={false} 
              tick={{fill: '#94A3B8', fontSize: 9, fontWeight: 700}} 
            />
            <Tooltip 
              cursor={{fill: '#F8FAFC'}}
              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
            />
            <Bar dataKey="stock" radius={[4, 4, 0, 0]} barSize={30}>
              {catItems.map((entry, i) => {
                const color = getColorByName(entry.name) || COLORS[index % COLORS.length];
                return (
                  <Cell key={`cell-${i}`} fill={color} />
                );
              })}
              <LabelList 
                dataKey="stock" 
                position="top" 
                style={{ fill: '#475569', fontSize: 10, fontWeight: 800 }}
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
  const [loading, setLoading] = useState(true);
  const [orderedCategoryIds, setOrderedCategoryIds] = useState<string[]>([]);

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
      
      // Initialize order if not set
      if (orderedCategoryIds.length === 0) {
        const filtered = cats.filter(cat => 
          TARGET_KEYWORDS.some(keyword => cat.name.toLowerCase().includes(keyword))
        );
        
        // Sort according to user request: PP Tiles, Soft Tiles, then Kerbs/Corner
        const sorted = [...filtered].sort((a, b) => {
          const aName = a.name.toLowerCase();
          const bName = b.name.toLowerCase();
          
          const getWeight = (name: string) => {
            if (name.includes('pp tile')) return 1;
            if (name.includes('soft tile')) return 2;
            if (name.includes('kerb male')) return 3;
            if (name.includes('kerb female')) return 4;
            if (name.includes('corner')) return 5;
            return 10;
          };
          
          return getWeight(aName) - getWeight(bName);
        });
        
        setOrderedCategoryIds(sorted.map(c => c.id));
      }
    });

    setLoading(false);
    return () => {
      unsubItems();
      unsubCategories();
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
        if (name.includes('pp tile')) return 1;
        if (name.includes('soft tile')) return 2;
        if (name.includes('kerb male')) return 3;
        if (name.includes('kerb female')) return 4;
        if (name.includes('corner')) return 5;
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
          <div className="px-4 py-2 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center gap-2">
            <Calendar size={16} className="text-blue-600" />
            <span className="text-xs font-black text-slate-700 uppercase tracking-widest">{format(new Date(), 'MMMM d, yyyy')}</span>
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
          <div className="grid grid-cols-6 gap-6">
            {filteredCategories.map((cat, index) => (
              <SortableChart 
                key={cat.id} 
                cat={cat} 
                items={items} 
                index={index} 
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
