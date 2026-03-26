import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  Legend,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';
import { 
  AlertTriangle, 
  Package, 
  ArrowRight,
  Download,
  Clock,
  TrendingUp,
  Calendar,
  Filter
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { Item, Transaction, Category } from '../types';
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subDays, subWeeks, subMonths, isWithinInterval, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval } from 'date-fns';
import * as XLSX from 'xlsx';

export default function Dashboard({ setView }: { setView: (view: string) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');
  const [selectedItemId, setSelectedItemId] = useState<string>('all');
  
  // Pinned items for overview cards
  const [pinnedItemIds, setPinnedItemIds] = useState<string[]>([]);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [overviewCategoryId, setOverviewCategoryId] = useState<string>('all');

  // Production Analytics State
  const [prodTimeframe, setProdTimeframe] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  useEffect(() => {
    const unsubItems = onSnapshot(collection(db, 'items'), (snap) => {
      const fetchedItems = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item));
      setItems(fetchedItems);
      
      // Initialize pinned items if empty
      const savedPinned = localStorage.getItem('pinnedItemIds');
      if (savedPinned) {
        setPinnedItemIds(JSON.parse(savedPinned));
      } else if (fetchedItems.length > 0) {
        setPinnedItemIds(fetchedItems.slice(0, 4).map(i => i.id));
      }
    });

    const unsubTransactions = onSnapshot(
      query(collection(db, 'transactions'), orderBy('date', 'desc')), 
      (snap) => {
        setTransactions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
      }
    );

    const unsubCategories = onSnapshot(collection(db, 'categories'), (snap) => {
      setCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    });

    setLoading(false);
    return () => {
      unsubItems();
      unsubTransactions();
      unsubCategories();
    };
  }, []);

  // Production Data Aggregation
  const productionData = useMemo(() => {
    const now = new Date();
    let intervals: Date[] = [];
    let formatStr = 'MMM dd';

    if (prodTimeframe === 'daily') {
      intervals = eachDayOfInterval({ start: subDays(now, 6), end: now });
      formatStr = 'EEE';
    } else if (prodTimeframe === 'weekly') {
      intervals = eachWeekOfInterval({ start: subWeeks(now, 3), end: now });
      formatStr = "'W'w";
    } else if (prodTimeframe === 'monthly') {
      intervals = eachMonthOfInterval({ start: subMonths(now, 5), end: now });
      formatStr = 'MMM';
    }

    return intervals.map(date => {
      let start: Date, end: Date;
      if (prodTimeframe === 'daily') {
        start = startOfDay(date);
        end = endOfDay(date);
      } else if (prodTimeframe === 'weekly') {
        start = startOfWeek(date);
        end = endOfWeek(date);
      } else {
        start = startOfMonth(date);
        end = endOfMonth(date);
      }

      const periodTxs = transactions.filter(tx => {
        const txDate = new Date(tx.date);
        return tx.type === 'IN' && isWithinInterval(txDate, { start, end });
      });

      const dataPoint: any = {
        name: format(date, formatStr),
        total: periodTxs.reduce((acc, tx) => acc + tx.quantity, 0)
      };

      // Breakdown by product
      items.forEach(item => {
        const itemQty = periodTxs
          .filter(tx => tx.itemId === item.id)
          .reduce((acc, tx) => acc + tx.quantity, 0);
        if (itemQty > 0) {
          dataPoint[item.name] = itemQty;
        }
      });

      return dataPoint;
    });
  }, [prodTimeframe, transactions, items]);

  // Get all product names that have production in the current data
  const productionProducts = useMemo(() => {
    const productSet = new Set<string>();
    productionData.forEach(d => {
      Object.keys(d).forEach(key => {
        if (key !== 'name' && key !== 'total') {
          productSet.add(key);
        }
      });
    });
    return Array.from(productSet);
  }, [productionData]);

  const togglePin = (id: string) => {
    const newPinned = pinnedItemIds.includes(id)
      ? pinnedItemIds.filter(pid => pid !== id)
      : [...pinnedItemIds, id];
    setPinnedItemIds(newPinned);
    localStorage.setItem('pinnedItemIds', JSON.stringify(newPinned));
  };

  const filteredItemsForChart = items.filter(item => {
    const catMatch = selectedCategoryId === 'all' || item.categoryId === selectedCategoryId;
    const itemMatch = selectedItemId === 'all' || item.id === selectedItemId;
    return catMatch && itemMatch;
  });

  const last7Days = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return d;
  }).reverse();

  const barData = last7Days.map(date => {
    const dayName = format(date, 'EEE');
    const dayStart = new Date(date).setHours(0, 0, 0, 0);
    const dayEnd = new Date(date).setHours(23, 59, 59, 999);
    
    const dayTxs = transactions.filter(tx => {
      const txDate = new Date(tx.date).getTime();
      const dateMatch = txDate >= dayStart && txDate <= dayEnd;
      const itemMatch = selectedItemId === 'all' 
        ? (selectedCategoryId === 'all' || items.find(i => i.id === tx.itemId)?.categoryId === selectedCategoryId)
        : tx.itemId === selectedItemId;
      return dateMatch && itemMatch;
    });

    const inBreakdown = dayTxs.filter(tx => tx.type === 'IN').reduce((acc: any, tx) => {
      const itemName = items.find(i => i.id === tx.itemId)?.name || 'Unknown';
      acc[itemName] = (acc[itemName] || 0) + tx.quantity;
      return acc;
    }, {});

    const outBreakdown = dayTxs.filter(tx => tx.type === 'OUT').reduce((acc: any, tx) => {
      const itemName = items.find(i => i.id === tx.itemId)?.name || 'Unknown';
      acc[itemName] = (acc[itemName] || 0) + tx.quantity;
      return acc;
    }, {});

    const scheduledBreakdown = dayTxs.filter(tx => tx.type === 'SCHEDULED').reduce((acc: any, tx) => {
      const itemName = items.find(i => i.id === tx.itemId)?.name || 'Unknown';
      acc[itemName] = (acc[itemName] || 0) + tx.quantity;
      return acc;
    }, {});

    return {
      name: dayName,
      in: dayTxs.filter(tx => tx.type === 'IN').reduce((acc, tx) => acc + tx.quantity, 0),
      out: dayTxs.filter(tx => tx.type === 'OUT').reduce((acc, tx) => acc + tx.quantity, 0),
      scheduled: dayTxs.filter(tx => tx.type === 'SCHEDULED').reduce((acc, tx) => acc + tx.quantity, 0),
      inBreakdown,
      outBreakdown,
      scheduledBreakdown
    };
  });

  // Prepare data for Pie Chart (Category distribution)
  const pieData = categories.map(cat => ({
    name: cat.name,
    value: items.filter(item => item.categoryId === cat.id).length
  })).filter(d => d.value > 0);

  const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#14B8A6'];

  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(items.map(item => ({
      'Item Name': item.name,
      'Category': categories.find(c => c.id === item.categoryId)?.name || 'Unknown',
      'Available Stock': item.currentStock,
      'Scheduled Stock': item.scheduledStock || 0,
      'Unit': item.unit,
      'Min Stock': item.minStock,
      'Status': item.currentStock <= item.minStock ? 'Low' : 'OK'
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, `Inventory_Summary_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const pinnedItems = items.filter(item => {
    if (overviewCategoryId === 'all') {
      return pinnedItemIds.includes(item.id);
    }
    return item.categoryId === overviewCategoryId;
  });

  const globalStats = {
    lowStockCount: items.filter(item => item.currentStock <= item.minStock).length,
    totalScheduled: items.reduce((acc, item) => acc + (item.scheduledStock || 0), 0)
  };

  if (loading) return <div className="flex items-center justify-center min-h-[400px]">
    <div className="h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
  </div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard Overview</h1>
          <p className="text-slate-500">Real-time inventory insights and analytics</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={overviewCategoryId}
            onChange={(e) => setOverviewCategoryId(e.target.value)}
            className="px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
          >
            <option value="all">All Categories</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          <button 
            onClick={() => setIsCustomizing(!isCustomizing)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors shadow-sm border ${
              isCustomizing ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Package size={18} />
            <span>{isCustomizing ? 'Finish Customizing' : 'Select Items to Show'}</span>
          </button>
          <button 
            onClick={exportToExcel}
            className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
          >
            <Download size={18} />
            <span>Export Summary</span>
          </button>
        </div>
      </div>

      {/* Global Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
              <AlertTriangle size={20} />
            </div>
          </div>
          <p className="text-slate-500 text-sm font-medium">Low Stock Items</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{globalStats.lowStockCount}</p>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-2">Requires Attention</p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-amber-50 text-amber-600 rounded-lg">
              <Clock size={20} />
            </div>
          </div>
          <p className="text-slate-500 text-sm font-medium">Total Scheduled</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{globalStats.totalScheduled}</p>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-2">To be Dispatched</p>
        </div>
      </div>

      {isCustomizing && (
        <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-blue-900 font-bold">Select items to display as cards on your home page</h3>
            <div className="text-xs text-blue-600 font-medium bg-blue-100 px-2 py-1 rounded">
              {overviewCategoryId === 'all' ? 'Showing All Items' : `Showing ${categories.find(c => c.id === overviewCategoryId)?.name}`}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {items
              .filter(item => overviewCategoryId === 'all' || item.categoryId === overviewCategoryId)
              .map(item => (
                <button
                  key={item.id}
                  onClick={() => togglePin(item.id)}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all border ${
                    pinnedItemIds.includes(item.id)
                      ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                  }`}
                >
                  {item.name}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Stats Grid - Product Wise Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {pinnedItems.map(item => {
          const isLow = item.currentStock <= item.minStock;
          const itemTxs = transactions.filter(tx => tx.itemId === item.id);
          
          const stockOutTotal = itemTxs
            .filter(tx => tx.type === 'OUT')
            .reduce((acc, tx) => acc + tx.quantity, 0);
          const stockInTotal = itemTxs
            .filter(tx => tx.type === 'IN')
            .reduce((acc, tx) => acc + tx.quantity, 0);
          const scheduledTotal = itemTxs
            .filter(tx => tx.type === 'SCHEDULED')
            .reduce((acc, tx) => acc + tx.quantity, 0);

          return (
            <div key={item.id} className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 relative group">
              <div className="flex items-center justify-between mb-4">
                <div className={`p-3 rounded-xl ${isLow ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}>
                  <Package size={24} />
                </div>
                {item.scheduledStock > 0 && (
                  <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-1 rounded-full uppercase tracking-wider">
                    {item.scheduledStock} Scheduled
                  </span>
                )}
                {isLow && (
                  <span className="text-[10px] font-bold text-rose-600 bg-rose-50 px-2 py-1 rounded-full uppercase tracking-wider">
                    Low Stock
                  </span>
                )}
              </div>
              <h3 className="text-slate-500 text-sm font-medium truncate pr-4">{item.name}</h3>
              <div className="flex items-baseline gap-2 mt-1">
                <p className="text-2xl font-bold text-slate-900">{item.currentStock}</p>
                <span className="text-xs text-slate-400 font-medium">{item.unit} (Available)</span>
              </div>
              <div className="mt-4 pt-4 border-t border-slate-50 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    In: <span className="text-emerald-500">{stockInTotal}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    Out: <span className="text-rose-500">{stockOutTotal}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                    Sch: <span className="text-amber-500">{scheduledTotal}</span>
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider text-right">
                  {categories.find(c => c.id === item.categoryId)?.name}
                </div>
              </div>
            </div>
          );
        })}
        {pinnedItems.length === 0 && !isCustomizing && (
          <div className="col-span-full bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
            <Package className="mx-auto text-slate-300 mb-4" size={48} />
            <h3 className="text-slate-900 font-bold">No items selected for overview</h3>
            <p className="text-slate-500 text-sm mt-1">Click "Select Items to Show" to customize your dashboard</p>
          </div>
        )}
      </div>

      {/* Production Analytics Section */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp size={20} className="text-blue-600" />
              <h3 className="text-lg font-bold text-slate-900">Production Analytics</h3>
            </div>
            <p className="text-slate-500 text-sm">Product-wise production trends (Stock IN)</p>
          </div>
          <div className="flex items-center bg-slate-100 p-1 rounded-xl">
            {(['daily', 'weekly', 'monthly'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setProdTimeframe(t)}
                className={`px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                  prodTimeframe === t 
                    ? 'bg-white text-blue-600 shadow-sm' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={productionData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fill: '#64748B', fontSize: 12}} 
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fill: '#64748B', fontSize: 12}} 
                />
                <Tooltip 
                  cursor={{fill: '#F8FAFC'}}
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-white p-4 rounded-xl shadow-xl border border-slate-100 min-w-[200px]">
                          <p className="font-bold text-slate-900 mb-2 border-b pb-2">{label} Production</p>
                          <div className="space-y-1.5">
                            {payload.map((entry: any, index: number) => (
                              <div key={index} className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full" style={{backgroundColor: entry.color}}></div>
                                  <span className="text-xs text-slate-600">{entry.name}</span>
                                </div>
                                <span className="text-xs font-bold text-slate-900">{entry.value}</span>
                              </div>
                            ))}
                            <div className="pt-2 mt-2 border-t border-slate-100 flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-900">Total</span>
                              <span className="text-xs font-bold text-blue-600">
                                {payload.reduce((acc: number, curr: any) => acc + curr.value, 0)}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend iconType="circle" />
                {productionProducts.map((product, index) => (
                  <Bar 
                    key={product} 
                    dataKey={product} 
                    stackId="a" 
                    fill={COLORS[index % COLORS.length]} 
                    radius={index === productionProducts.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-6">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Filter size={16} className="text-slate-400" />
              Top Products this Period
            </h4>
            <div className="space-y-3">
              {productionProducts
                .map(p => ({
                  name: p,
                  total: productionData.reduce((acc, d) => acc + (d[p] || 0), 0)
                }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 5)
                .map((p, i) => (
                  <div key={p.name} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center text-xs font-bold text-slate-400 border border-slate-100 shadow-sm">
                        0{i + 1}
                      </div>
                      <span className="text-sm font-medium text-slate-700">{p.name}</span>
                    </div>
                    <span className="text-sm font-bold text-blue-600">{p.total}</span>
                  </div>
                ))}
              {productionProducts.length === 0 && (
                <div className="text-center py-12 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <Calendar className="mx-auto text-slate-300 mb-2" size={32} />
                  <p className="text-slate-400 text-xs italic">No production recorded for this period</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 gap-8">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <h3 className="text-lg font-bold text-slate-900">Stock Movement (Weekly)</h3>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={selectedCategoryId}
                onChange={(e) => {
                  setSelectedCategoryId(e.target.value);
                  setSelectedItemId('all');
                }}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Categories</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
              <select
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Products</option>
                {items
                  .filter(i => selectedCategoryId === 'all' || i.categoryId === selectedCategoryId)
                  .map(item => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
              </select>
            </div>
          </div>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748B', fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748B', fontSize: 12}} />
                <Tooltip 
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-white p-4 rounded-xl shadow-xl border border-slate-100 min-w-[200px]">
                          <p className="font-bold text-slate-900 mb-2">{label}</p>
                          <div className="space-y-3">
                            <div>
                              <p className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">Stock IN: {data.in}</p>
                              {Object.entries(data.inBreakdown).map(([name, qty]: any) => (
                                <p key={name} className="text-[11px] text-slate-600 flex justify-between">
                                  <span>{name}</span>
                                  <span className="font-medium">{qty}</span>
                                </p>
                              ))}
                            </div>
                            <div className="pt-2 border-t border-slate-50">
                              <p className="text-xs font-bold text-rose-600 uppercase tracking-wider mb-1">Stock OUT: {data.out}</p>
                              {Object.entries(data.outBreakdown).map(([name, qty]: any) => (
                                <p key={name} className="text-[11px] text-slate-600 flex justify-between">
                                  <span>{name}</span>
                                  <span className="font-medium">{qty}</span>
                                </p>
                              ))}
                            </div>
                            <div className="pt-2 border-t border-slate-50">
                              <p className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1">Scheduled: {data.scheduled}</p>
                              {Object.entries(data.scheduledBreakdown).map(([name, qty]: any) => (
                                <p key={name} className="text-[11px] text-slate-600 flex justify-between">
                                  <span>{name}</span>
                                  <span className="font-medium">{qty}</span>
                                </p>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Legend iconType="circle" wrapperStyle={{paddingTop: '20px'}} />
                <Bar dataKey="in" name="Stock IN" fill="#2563EB" radius={[4, 4, 0, 0]} />
                <Bar dataKey="out" name="Stock OUT" fill="#EF4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="scheduled" name="Scheduled" fill="#F59E0B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent Transactions & Low Stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900">Recent Transactions</h3>
            <button 
              onClick={() => setView('transactions')}
              className="text-blue-600 text-sm font-semibold hover:text-blue-700 flex items-center gap-1"
            >
              View All <ArrowRight size={16} />
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                  <th className="px-6 py-3 font-semibold">Voucher</th>
                  <th className="px-6 py-3 font-semibold">Item</th>
                  <th className="px-6 py-3 font-semibold">Type</th>
                  <th className="px-6 py-3 font-semibold">Qty</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions
                  .filter(tx => {
                    const itemMatch = selectedItemId === 'all' 
                      ? (selectedCategoryId === 'all' || items.find(i => i.id === tx.itemId)?.categoryId === selectedCategoryId)
                      : tx.itemId === selectedItemId;
                    
                    return itemMatch;
                  })
                  .slice(0, 10).map((tx) => (
                  <tr 
                    key={tx.id} 
                    onClick={() => setView('transactions')}
                    className="hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <td className="px-6 py-4 text-sm font-medium text-slate-900">{tx.voucherNo}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {items.find(i => i.id === tx.itemId)?.name || 'Unknown Item'}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        tx.type === 'IN' ? 'bg-emerald-100 text-emerald-800' : 
                        tx.type === 'OUT' ? 'bg-rose-100 text-rose-800' :
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">{tx.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900">Low Stock Alerts</h3>
            <span className="bg-rose-100 text-rose-800 text-xs font-bold px-2.5 py-1 rounded-full">
              {items.filter(item => item.currentStock <= item.minStock).length} Critical
            </span>
          </div>
          <div className="p-6 space-y-4">
            {items
              .filter(item => item.currentStock <= item.minStock)
              .filter(item => {
                const catMatch = selectedCategoryId === 'all' || item.categoryId === selectedCategoryId;
                const itemMatch = selectedItemId === 'all' || item.id === selectedItemId;
                return catMatch && itemMatch;
              })
              .slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="bg-white p-2 rounded-lg shadow-sm">
                    <Package size={20} className="text-slate-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">{item.name}</h4>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-rose-600">{item.currentStock} {item.unit}</p>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Current</p>
                </div>
              </div>
            ))}
            {items.filter(item => item.currentStock <= item.minStock).length === 0 && (
              <div className="text-center py-8">
                <p className="text-slate-400 italic">All stock levels are healthy</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
