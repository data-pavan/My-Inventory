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
  TrendingDown,
  Plus,
  Calendar,
  Filter,
  ChevronRight,
  User,
  MapPin,
  ShieldCheck,
  ShieldAlert,
  Search,
  RefreshCw,
  X
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

  // Health Check State
  const [isHealthChecking, setIsHealthChecking] = useState(false);
  const [healthResults, setHealthResults] = useState<{
    totalItems: number;
    discrepancyCount: number;
    itemsWithDiscrepancy: { item: Item, calculated: number, current: number }[];
  } | null>(null);

  const runHealthCheck = () => {
    setIsHealthChecking(true);
    setTimeout(() => {
      const results: { item: Item, calculated: number, current: number }[] = [];
      
      items.forEach(item => {
        const itemTxs = transactions.filter(tx => tx.itemId === item.id);
        let calculated = Number(item.initialStock || 0);
        itemTxs.forEach(tx => {
          const qty = Number(tx.quantity || 0);
          if (tx.type === 'IN' || tx.type === 'FACTORY_IN') {
            calculated += qty;
          } else if (tx.type === 'OUT' || tx.type === 'SCHEDULED') {
            calculated -= qty;
          }
        });
        
        const current = Number(item.currentStock || 0);
        if (Math.abs(calculated - current) > 0.001) {
          results.push({ item, calculated, current });
        }
      });

      setHealthResults({
        totalItems: items.length,
        discrepancyCount: results.length,
        itemsWithDiscrepancy: results
      });
      setIsHealthChecking(false);
    }, 800);
  };

  const [expandedRecentGroups, setExpandedRecentGroups] = useState<{ [key: string]: boolean }>({});
  const toggleRecentGroup = (groupKey: string) => {
    setExpandedRecentGroups(prev => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }));
  };

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

  const groupedRecentTransactions = useMemo(() => {
    const groups: { [key: string]: Transaction[] } = {};
    transactions.forEach(tx => {
      const key = tx.invoiceNo || tx.voucherNo;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(tx);
    });
    return Object.entries(groups)
      .sort((a, b) => new Date(b[1][0].date).getTime() - new Date(a[1][0].date).getTime())
      .slice(0, 5);
  }, [transactions]);

  const groupedScheduled = useMemo(() => {
    const scheduledTxs = transactions.filter(tx => tx.type === 'SCHEDULED');
    const groups: { [key: string]: Transaction[] } = {};
    scheduledTxs.forEach(tx => {
      const key = tx.invoiceNo || tx.voucherNo;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(tx);
    });
    return Object.entries(groups).sort((a, b) => 
      new Date(b[1][0].date).getTime() - new Date(a[1][0].date).getTime()
    );
  }, [transactions]);

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
    const sortedItems = [...items].sort((a, b) => {
      const catA = categories.find(c => c.id === a.categoryId)?.name || '';
      const catB = categories.find(c => c.id === b.categoryId)?.name || '';
      if (catA === catB) {
        return a.name.localeCompare(b.name);
      }
      return catA.localeCompare(catB);
    });

    const ws = XLSX.utils.json_to_sheet(sortedItems.map(item => ({
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
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Dashboard Overview</h1>
          <p className="text-xs text-slate-500">Real-time inventory insights and analytics</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={overviewCategoryId}
            onChange={(e) => setOverviewCategoryId(e.target.value)}
            className="flex-1 sm:flex-none px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
          >
            <option value="all">All Categories</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          <button 
            onClick={() => setIsCustomizing(!isCustomizing)}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors shadow-sm border text-sm font-medium ${
              isCustomizing ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Package size={18} />
            <span>{isCustomizing ? 'Finish' : 'Select Items'}</span>
          </button>
          <button 
            onClick={runHealthCheck}
            disabled={isHealthChecking}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-lg text-indigo-700 hover:bg-indigo-100 transition-colors shadow-sm text-sm font-medium disabled:opacity-50"
          >
            {isHealthChecking ? <RefreshCw size={18} className="animate-spin" /> : <ShieldCheck size={18} />}
            <span>Health Check</span>
          </button>
          <button 
            onClick={exportToExcel}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors shadow-sm text-sm font-medium"
          >
            <Download size={18} />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Global Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 px-1 sm:px-0">
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-between min-h-[120px]">
          <div className="flex items-center justify-between">
            <div className="p-2 bg-rose-50 text-rose-600 rounded-xl">
              <AlertTriangle size={20} />
            </div>
            <span className="text-[10px] font-black text-rose-600 bg-rose-100 px-2 py-0.5 rounded-full uppercase tracking-widest">Critical</span>
          </div>
          <div>
            <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.15em]">Low Stock</p>
            <p className="text-2xl font-black text-slate-900 leading-none mt-1">{Number(globalStats.lowStockCount) || 0}</p>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col min-h-[120px] col-span-2 lg:col-span-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-50 text-amber-600 rounded-xl">
                <Clock size={20} />
              </div>
              <div>
                <p className="text-slate-500 text-[10px] font-black uppercase tracking-[0.15em]">Scheduled Orders</p>
                <p className="text-xs font-bold text-slate-400">{groupedScheduled.length} Pending PIs</p>
              </div>
            </div>
            <span className="text-[10px] font-black text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full uppercase tracking-widest">Pending</span>
          </div>
          
          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {groupedScheduled.map(([groupKey, groupTxs], index) => {
              const firstTx = groupTxs[groupTxs.length - 1];
              return (
                <div key={groupKey} className="bg-slate-50/50 rounded-xl p-4 border border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-black text-slate-400">{index + 1}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-[11px] font-black text-slate-900 truncate">{groupKey}</p>
                        <span className="text-[8px] font-black text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-lg uppercase tracking-widest">
                          {groupTxs.length} Items
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <p className="text-[9px] font-bold text-slate-500 flex items-center gap-1">
                          <User size={10} /> {firstTx.salesPerson || 'N/A'}
                        </p>
                        <p className="text-[9px] font-bold text-slate-500 flex items-center gap-1">
                          <MapPin size={10} /> {firstTx.sourceDestination || 'N/A'}
                        </p>
                        <p className="text-[9px] font-bold text-slate-500 flex items-center gap-1">
                          <Calendar size={10} /> {format(new Date(firstTx.date), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                  </div>
                  <button 
                    onClick={() => setView('transactions')}
                    className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-black text-slate-600 uppercase tracking-widest hover:bg-slate-50 transition-all shrink-0"
                  >
                    View Details
                  </button>
                </div>
              );
            })}
            {groupedScheduled.length === 0 && (
              <div className="py-12 text-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                <Clock size={32} className="mx-auto text-slate-300 mb-3" />
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">No Scheduled Orders Found</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {isCustomizing && (
        <div className="bg-indigo-50 p-6 rounded-2xl border border-indigo-100 animate-in fade-in slide-in-from-top-4 duration-300 mx-1 sm:mx-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h3 className="text-indigo-900 font-black uppercase tracking-tight text-lg">Customize Overview</h3>
              <p className="text-[11px] text-indigo-600 font-bold uppercase tracking-widest">Select products to pin on dashboard</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => {
                  const allIds = items
                    .filter(item => overviewCategoryId === 'all' || item.categoryId === overviewCategoryId)
                    .map(i => i.id);
                  const newPinned = Array.from(new Set([...pinnedItemIds, ...allIds]));
                  setPinnedItemIds(newPinned);
                  localStorage.setItem('pinnedItemIds', JSON.stringify(newPinned));
                }}
                className="text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:bg-indigo-100 bg-white border border-indigo-100 px-3 py-1.5 rounded-xl transition-all"
              >
                Select All
              </button>
              <button
                onClick={() => {
                  const currentCategoryIds = items
                    .filter(item => overviewCategoryId === 'all' || item.categoryId === overviewCategoryId)
                    .map(i => i.id);
                  const newPinned = pinnedItemIds.filter(id => !currentCategoryIds.includes(id));
                  setPinnedItemIds(newPinned);
                  localStorage.setItem('pinnedItemIds', JSON.stringify(newPinned));
                }}
                className="text-[10px] font-black uppercase tracking-widest text-slate-500 hover:bg-slate-100 bg-white border border-slate-100 px-3 py-1.5 rounded-xl transition-all"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 sm:gap-3">
            {items
              .filter(item => overviewCategoryId === 'all' || item.categoryId === overviewCategoryId)
              .map(item => (
                <button
                  key={item.id}
                  onClick={() => togglePin(item.id)}
                  className={`px-4 py-3 rounded-2xl text-[10px] font-bold uppercase tracking-wider transition-all border truncate ${
                    pinnedItemIds.includes(item.id)
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-600/20'
                      : 'bg-white text-slate-600 border-slate-100 hover:border-indigo-300'
                  }`}
                >
                  {item.name}
                </button>
              ))}
          </div>
        </div>
      )}

      {/* Stats Grid - Category Wise Grouping */}
      <div className="space-y-8">
        {categories
          .filter(cat => overviewCategoryId === 'all' || cat.id === overviewCategoryId)
          .map(category => {
            const categoryItems = pinnedItems.filter(item => item.categoryId === category.id);
            if (categoryItems.length === 0) return null;

            return (
              <div key={category.id} className="space-y-4">
                <div className="flex items-center gap-3 px-1 sm:px-0">
                  <div className="h-6 w-1 bg-blue-600 rounded-full"></div>
                  <h2 className="text-sm font-black text-slate-900 uppercase tracking-widest">{category.name}</h2>
                  <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">
                    {categoryItems.length} {categoryItems.length === 1 ? 'Item' : 'Items'}
                  </span>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 px-1 sm:px-0">
                  {categoryItems.map(item => {
                    const currentStock = Number(item.currentStock) || 0;
                    const minStock = Number(item.minStock) || 0;
                    const isLow = currentStock <= minStock;
                    const itemTxs = transactions.filter(tx => tx.itemId === item.id);
                    
                    const stockOutTotal = itemTxs
                      .filter(tx => tx.type === 'OUT' || tx.type === 'SCHEDULED')
                      .reduce((acc, tx) => acc + tx.quantity, 0);
                    const stockInTotal = itemTxs
                      .filter(tx => tx.type === 'IN' || tx.type === 'FACTORY_IN')
                      .reduce((acc, tx) => acc + tx.quantity, 0);
                    const scheduledTotal = itemTxs
                      .filter(tx => tx.type === 'SCHEDULED')
                      .reduce((acc, tx) => acc + tx.quantity, 0);

                    return (
                      <div key={item.id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-50 relative group transition-all hover:shadow-xl hover:shadow-slate-200/50">
                        <div className="flex items-center justify-between mb-4">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${isLow ? 'bg-rose-50 text-rose-600' : 'bg-indigo-50 text-indigo-600'}`}>
                            <Package size={24} />
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            {Number(item.scheduledStock) > 0 && (
                              <span className="text-[9px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
                                {Number(item.scheduledStock) || 0} Sch
                              </span>
                            )}
                            {isLow && (
                              <span className="text-[9px] font-black text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full uppercase tracking-widest animate-pulse">
                                Low
                              </span>
                            )}
                          </div>
                        </div>
                        <h3 className="text-slate-400 text-[10px] font-black uppercase tracking-[0.15em] mb-1 truncate">{item.name}</h3>
                        <div className="flex items-baseline gap-1.5">
                          <p className="text-3xl font-black text-slate-900 leading-none">{Number(item.currentStock) || 0}</p>
                          <span className="text-11px text-slate-400 font-bold uppercase tracking-widest">{item.unit}</span>
                        </div>
                        
                        <div className="mt-6 pt-5 border-t border-slate-50 grid grid-cols-3 gap-2">
                          <div className="text-center">
                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">In</p>
                            <p className="text-xs font-black text-emerald-600">{Number(stockInTotal) || 0}</p>
                          </div>
                          <div className="text-center border-x border-slate-50">
                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Out</p>
                            <p className="text-xs font-black text-rose-600">{Number(stockOutTotal) || 0}</p>
                          </div>
                          <div className="text-center">
                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Sch</p>
                            <p className="text-xs font-black text-amber-600">{Number(scheduledTotal) || 0}</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

        {pinnedItems.length === 0 && !isCustomizing && (
          <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center mx-1 sm:mx-0">
            <div className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm">
              <Package className="text-slate-200" size={40} />
            </div>
            <h3 className="text-slate-900 font-black uppercase tracking-tight text-lg">No Items Pinned</h3>
            <p className="text-slate-500 text-xs font-medium mt-2">Customize your dashboard to see product-wise stats</p>
            <button 
              onClick={() => setIsCustomizing(true)}
              className="mt-6 bg-white border border-slate-200 px-6 py-2.5 rounded-2xl text-slate-700 font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-all shadow-sm"
            >
              Select Items
            </button>
          </div>
        )}
      </div>

      {/* Production Analytics Section */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-50 mx-1 sm:mx-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <TrendingUp size={20} />
              </div>
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Production Analytics</h3>
            </div>
            <p className="text-slate-500 text-[11px] font-bold uppercase tracking-widest ml-13">Stock In Trends</p>
          </div>
          <div className="flex items-center bg-slate-50 p-1.5 rounded-2xl self-start sm:self-auto border border-slate-100">
            {(['daily', 'weekly', 'monthly'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setProdTimeframe(t)}
                className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  prodTimeframe === t 
                    ? 'bg-white text-indigo-600 shadow-md shadow-indigo-600/5' 
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={productionData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F8FAFC" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fill: '#94A3B8', fontSize: 10, fontWeight: 700}} 
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{fill: '#94A3B8', fontSize: 10, fontWeight: 700}} 
                />
                <Tooltip 
                  cursor={{fill: '#F8FAFC'}}
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-white p-5 rounded-2xl shadow-2xl border border-slate-50 min-w-[220px] animate-in zoom-in-95 duration-200">
                          <p className="font-black text-slate-900 text-[10px] uppercase tracking-widest mb-4 border-b border-slate-50 pb-3">{label} Production</p>
                          <div className="space-y-2.5">
                            {payload.map((entry: any, index: number) => (
                              <div key={index} className="flex items-center justify-between gap-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 rounded-full" style={{backgroundColor: entry.color}}></div>
                                  <span className="text-[11px] font-bold text-slate-600">{entry.name}</span>
                                </div>
                                <span className="text-[11px] font-black text-slate-900">{entry.value}</span>
                              </div>
                            ))}
                            <div className="pt-3 mt-3 border-t border-slate-100 flex items-center justify-between">
                              <span className="text-[11px] font-black text-slate-900 uppercase tracking-widest">Total</span>
                              <span className="text-[11px] font-black text-indigo-600">
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
                <Legend iconType="circle" wrapperStyle={{fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', paddingTop: '20px'}} />
                {productionProducts.map((product, index) => (
                  <Bar 
                    key={product} 
                    dataKey={product} 
                    stackId="a" 
                    fill={COLORS[index % COLORS.length]} 
                    radius={index === productionProducts.length - 1 ? [6, 6, 0, 0] : [0, 0, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-6">
            <h4 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] flex items-center gap-2">
              <Filter size={16} />
              Top Performers
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
                  <div key={p.name} className="flex items-center justify-between p-4 bg-slate-50/50 rounded-2xl border border-slate-100 transition-all hover:bg-white hover:shadow-lg hover:shadow-slate-100">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center text-xs font-black text-slate-300 border border-slate-100 shadow-sm">
                        {i + 1}
                      </div>
                      <span className="text-xs font-black text-slate-700 truncate max-w-[140px] uppercase tracking-tight">{p.name}</span>
                    </div>
                    <span className="text-sm font-black text-indigo-600">{p.total}</span>
                  </div>
                ))}
              {productionProducts.length === 0 && (
                <div className="text-center py-16 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                  <Calendar className="mx-auto text-slate-200 mb-4" size={32} />
                  <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest">No Data Available</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 gap-6">
        <div className="bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
            <h3 className="text-sm sm:text-base font-bold text-slate-900">Stock Movement (Weekly)</h3>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedCategoryId}
                onChange={(e) => {
                  setSelectedCategoryId(e.target.value);
                  setSelectedItemId('all');
                }}
                className="flex-1 sm:flex-none px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[10px] sm:text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">Categories</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
              <select
                value={selectedItemId}
                onChange={(e) => setSelectedItemId(e.target.value)}
                className="flex-1 sm:flex-none px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-[10px] sm:text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">Products</option>
                {items
                  .filter(i => selectedCategoryId === 'all' || i.categoryId === selectedCategoryId)
                  .map(item => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
              </select>
            </div>
          </div>
          <div className="h-56 sm:h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748B', fontSize: 10}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748B', fontSize: 10}} />
                <Tooltip 
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-white p-3 sm:p-4 rounded-xl shadow-xl border border-slate-100 min-w-[150px] sm:min-w-[200px]">
                          <p className="font-bold text-slate-900 text-xs sm:text-sm mb-2">{label}</p>
                          <div className="space-y-3">
                            <div>
                              <p className="text-[10px] sm:text-xs font-bold text-blue-600 uppercase tracking-wider mb-1">Stock IN: {Number(data.in) || 0}</p>
                              {Object.entries(data.inBreakdown).map(([name, qty]: any) => (
                                <p key={name} className="text-[9px] sm:text-[11px] text-slate-600 flex justify-between">
                                  <span>{name}</span>
                                  <span className="font-medium">{Number(qty) || 0}</span>
                                </p>
                              ))}
                            </div>
                            <div className="pt-2 border-t border-slate-50">
                              <p className="text-[10px] sm:text-xs font-bold text-rose-600 uppercase tracking-wider mb-1">Stock OUT: {Number(data.out) || 0}</p>
                              {Object.entries(data.outBreakdown).map(([name, qty]: any) => (
                                <p key={name} className="text-[9px] sm:text-[11px] text-slate-600 flex justify-between">
                                  <span>{name}</span>
                                  <span className="font-medium">{Number(qty) || 0}</span>
                                </p>
                              ))}
                            </div>
                            <div className="pt-2 border-t border-slate-50">
                              <p className="text-[10px] sm:text-xs font-bold text-amber-600 uppercase tracking-wider mb-1">Scheduled: {Number(data.scheduled) || 0}</p>
                              {Object.entries(data.scheduledBreakdown).map(([name, qty]: any) => (
                                <p key={name} className="text-[9px] sm:text-[11px] text-slate-600 flex justify-between">
                                  <span>{name}</span>
                                  <span className="font-medium">{Number(qty) || 0}</span>
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
                <Legend iconType="circle" wrapperStyle={{paddingTop: '10px', fontSize: '10px'}} />
                <Bar dataKey="in" name="Stock IN" fill="#2563EB" radius={[4, 4, 0, 0]} />
                <Bar dataKey="out" name="Stock OUT" fill="#EF4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="scheduled" name="Scheduled" fill="#F59E0B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent Transactions & Low Stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm sm:text-base font-bold text-slate-900">Recent Transactions</h3>
            <button 
              onClick={() => setView('transactions')}
              className="text-blue-600 text-[10px] sm:text-xs font-semibold hover:text-blue-700 flex items-center gap-1"
            >
              View All <ArrowRight size={14} />
            </button>
          </div>
          <div className="p-4 space-y-4">
            {groupedRecentTransactions.map(([groupKey, groupTxs]) => {
              const firstTx = groupTxs[0];
              const isExpanded = expandedRecentGroups[groupKey];
              
              return (
                <div key={groupKey} className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                  <div 
                    onClick={() => toggleRecentGroup(groupKey)}
                    className="flex min-h-[80px] cursor-pointer hover:bg-slate-50/50 transition-colors"
                  >
                    {/* Left Side - 30% Details Area */}
                    <div className="w-[30%] bg-slate-50/50 p-3 border-r border-slate-100 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div>
                          <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-0.5">PI / Invoice</p>
                          <p className="text-[10px] font-black text-slate-900 truncate">{groupKey}</p>
                        </div>
                        <div>
                          <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Sales Person</p>
                          <p className="text-[10px] font-bold text-slate-600 truncate">{firstTx.salesPerson || 'N/A'}</p>
                        </div>
                      </div>
                    </div>

                    {/* Right Side - Summary */}
                    <div className="w-[70%] p-3 flex flex-col justify-between">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            firstTx.type === 'IN' ? 'bg-emerald-100 text-emerald-600' : 
                            firstTx.type === 'OUT' ? 'bg-rose-100 text-rose-600' : 
                            firstTx.type === 'FACTORY_IN' ? 'bg-indigo-100 text-indigo-600' :
                            'bg-amber-100 text-amber-600'
                          }`}>
                            {firstTx.type === 'IN' ? <TrendingUp size={16} /> : 
                             firstTx.type === 'OUT' ? <TrendingDown size={16} /> :
                             firstTx.type === 'FACTORY_IN' ? <Plus size={16} /> :
                             <Clock size={16} />}
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-black text-slate-900 text-[11px] uppercase tracking-tight truncate">
                              {firstTx.type === 'IN' ? 'Stock In' : 
                               firstTx.type === 'OUT' ? 'Stock Out' : 
                               firstTx.type === 'FACTORY_IN' ? 'Factory In' :
                               'Scheduled'}
                            </h3>
                            <p className="text-[9px] font-bold text-slate-400">{format(new Date(firstTx.date), 'MMM d, HH:mm')}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="bg-slate-100 text-slate-700 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest">
                            {groupTxs.length} Items
                          </div>
                          <ChevronRight 
                            size={16} 
                            className={`text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} 
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="bg-slate-50/30 p-3 space-y-2 border-t border-slate-100 animate-in slide-in-from-top-2 duration-200">
                      <div className="flex items-center gap-2 mb-2">
                        <MapPin size={12} className="text-slate-400" />
                        <span className="text-[10px] font-bold text-slate-600 uppercase tracking-tight truncate">
                          {firstTx.sourceDestination || 'N/A'}
                        </span>
                      </div>
                      {groupTxs.map((tx) => {
                        const item = items.find(i => i.id === tx.itemId);
                        return (
                          <div key={tx.id} className="bg-white border border-slate-100 rounded-xl p-2 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-6 h-6 rounded-lg bg-slate-50 flex items-center justify-center shrink-0 border border-slate-100">
                                <Package size={12} className="text-slate-400" />
                              </div>
                              <div className="min-w-0">
                                <h4 className="font-bold text-slate-900 text-[10px] truncate">{item?.name || 'Unknown Item'}</h4>
                                <p className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">{tx.quantity} {item?.unit}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <button 
                        onClick={() => setView('transactions')}
                        className="w-full mt-2 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-black text-blue-600 uppercase tracking-widest hover:bg-blue-50 transition-all"
                      >
                        View Full Transaction
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm sm:text-base font-bold text-slate-900">Low Stock Alerts</h3>
            <span className="bg-rose-100 text-rose-800 text-[8px] sm:text-[10px] font-bold px-2 py-0.5 rounded-full">
              {items.filter(item => (Number(item.currentStock) || 0) <= (Number(item.minStock) || 0)).length} Critical
            </span>
          </div>
          <div className="p-4 sm:p-5 space-y-2 sm:space-y-3">
            {items
              .filter(item => (Number(item.currentStock) || 0) <= (Number(item.minStock) || 0))
              .filter(item => {
                const catMatch = selectedCategoryId === 'all' || item.categoryId === selectedCategoryId;
                const itemMatch = selectedItemId === 'all' || item.id === selectedItemId;
                return catMatch && itemMatch;
              })
              .slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-center justify-between p-2 sm:p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex items-center gap-2 sm:gap-2.5">
                  <div className="bg-white p-1.5 rounded-lg shadow-sm">
                    <Package size={16} className="text-slate-400" />
                  </div>
                  <div>
                    <h4 className="text-[10px] sm:text-xs font-bold text-slate-900 truncate max-w-[120px] sm:max-w-none">{item.name}</h4>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] sm:text-xs font-bold text-rose-600">{item.currentStock} {item.unit}</p>
                  <p className="text-[8px] sm:text-[9px] text-slate-400 uppercase tracking-wider font-bold">Current</p>
                </div>
              </div>
            ))}
            {items.filter(item => (Number(item.currentStock) || 0) <= (Number(item.minStock) || 0)).length === 0 && (
              <div className="text-center py-6">
                <p className="text-slate-400 text-[10px] sm:text-xs italic">All stock levels are healthy</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Health Check Modal */}
      {healthResults && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in duration-300 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
              <div className="flex items-center gap-3">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${healthResults.discrepancyCount > 0 ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                  {healthResults.discrepancyCount > 0 ? <ShieldAlert size={24} /> : <ShieldCheck size={24} />}
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">System Health Check</h3>
                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">Audit complete for {healthResults.totalItems} items</p>
                </div>
              </div>
              <button onClick={() => setHealthResults(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
              {healthResults.discrepancyCount === 0 ? (
                <div className="text-center py-12">
                  <div className="w-20 h-20 bg-emerald-50 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <ShieldCheck size={40} />
                  </div>
                  <h4 className="text-xl font-black text-slate-900 uppercase tracking-tight">All Systems Nominal</h4>
                  <p className="text-slate-500 text-sm mt-2">Every item's current stock matches its transaction history perfectly.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-start gap-3">
                    <AlertTriangle className="text-rose-600 shrink-0" size={20} />
                    <div>
                      <p className="text-sm font-bold text-rose-900">{healthResults.discrepancyCount} Discrepancies Found</p>
                      <p className="text-xs text-rose-700 mt-1">The following items have stock levels that do not match their transaction logs. This may be due to manual edits or historical bugs.</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Affected Items</h4>
                    <div className="border border-slate-100 rounded-2xl overflow-hidden">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-[10px] text-slate-500 uppercase font-black">
                          <tr>
                            <th className="px-4 py-2">Item Name</th>
                            <th className="px-4 py-2 text-right">Current</th>
                            <th className="px-4 py-2 text-right">Calculated</th>
                            <th className="px-4 py-2 text-right">Diff</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {healthResults.itemsWithDiscrepancy.map(({ item, calculated, current }) => (
                            <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-4 py-2">
                                <p className="font-bold text-slate-900">{item.name}</p>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{item.unit}</p>
                              </td>
                              <td className="px-4 py-2 text-right font-medium text-slate-600">{current}</td>
                              <td className="px-4 py-2 text-right font-black text-indigo-600">{calculated}</td>
                              <td className="px-4 py-2 text-right">
                                <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${calculated - current > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                  {calculated - current > 0 ? `+${(calculated - current).toFixed(2)}` : (calculated - current).toFixed(2)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button 
                onClick={() => setHealthResults(null)}
                className="flex-1 px-6 py-4 rounded-2xl text-sm font-black text-slate-500 bg-white border-2 border-slate-200 hover:bg-slate-100 transition-all uppercase tracking-widest"
              >
                Close
              </button>
              {healthResults.discrepancyCount > 0 && (
                <button 
                  onClick={() => setView('items')}
                  className="flex-[2] px-6 py-4 rounded-2xl text-sm font-black text-white bg-indigo-600 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20 uppercase tracking-widest flex items-center justify-center gap-2"
                >
                  <Package size={18} />
                  <span>Go to Item Management to Fix</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
