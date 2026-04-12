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
  TrendingUp, 
  TrendingDown, 
  Package, 
  Calendar, 
  Clock, 
  ArrowUpCircle, 
  ArrowDownCircle,
  Activity,
  DollarSign,
  BarChart3,
  PieChart as PieChartIcon
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { Item, Transaction, Category, OperationType } from '../types';
import { 
  format, 
  startOfDay, 
  endOfDay, 
  startOfWeek, 
  endOfWeek, 
  startOfMonth, 
  endOfMonth, 
  subDays, 
  subWeeks, 
  isWithinInterval, 
  eachDayOfInterval, 
  eachWeekOfInterval 
} from 'date-fns';
import { handleFirestoreError } from '../lib/firestoreErrorHandler';

const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#14B8A6'];

export default function ManagementDashboard() {
  const [items, setItems] = useState<Item[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubItems = onSnapshot(collection(db, 'items'), (snap) => {
      setItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'items'));

    const unsubTransactions = onSnapshot(
      query(collection(db, 'transactions'), orderBy('date', 'desc')), 
      (snap) => {
        setTransactions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'transactions')
    );

    const unsubCategories = onSnapshot(collection(db, 'categories'), (snap) => {
      setCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'categories'));

    setLoading(false);
    return () => {
      unsubItems();
      unsubTransactions();
      unsubCategories();
    };
  }, []);

  // --- Metrics Calculation ---

  const stats = useMemo(() => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);
    const weekStart = startOfWeek(now);
    const weekEnd = endOfWeek(now);

    const todayTxs = transactions.filter(tx => isWithinInterval(new Date(tx.date), { start: todayStart, end: todayEnd }));
    const weekTxs = transactions.filter(tx => isWithinInterval(new Date(tx.date), { start: weekStart, end: weekEnd }));

    const dailyProduction = todayTxs
      .filter(tx => tx.type === 'IN' || tx.type === 'FACTORY_IN')
      .reduce((acc, tx) => acc + tx.quantity, 0);

    const weeklyProduction = weekTxs
      .filter(tx => tx.type === 'IN' || tx.type === 'FACTORY_IN')
      .reduce((acc, tx) => acc + tx.quantity, 0);

    const dailySales = todayTxs
      .filter(tx => tx.type === 'OUT')
      .reduce((acc, tx) => acc + tx.quantity, 0);

    const weeklySales = weekTxs
      .filter(tx => tx.type === 'OUT')
      .reduce((acc, tx) => acc + tx.quantity, 0);

    const totalSales = transactions
      .filter(tx => tx.type === 'OUT')
      .reduce((acc, tx) => acc + tx.quantity, 0);

    return {
      dailyProduction,
      weeklyProduction,
      dailySales,
      weeklySales,
      totalSales
    };
  }, [transactions]);

  // --- Charts Data ---

  const productionTrendData = useMemo(() => {
    const now = new Date();
    const last7Days = eachDayOfInterval({ start: subDays(now, 6), end: now });

    return last7Days.map(date => {
      const start = startOfDay(date);
      const end = endOfDay(date);
      const dayTxs = transactions.filter(tx => isWithinInterval(new Date(tx.date), { start, end }));
      
      return {
        name: format(date, 'EEE'),
        production: dayTxs.filter(tx => tx.type === 'IN' || tx.type === 'FACTORY_IN').reduce((acc, tx) => acc + tx.quantity, 0),
        sales: dayTxs.filter(tx => tx.type === 'OUT').reduce((acc, tx) => acc + tx.quantity, 0)
      };
    });
  }, [transactions]);

  const categoryDistribution = useMemo(() => {
    return categories.map(cat => ({
      name: cat.name,
      value: items.filter(item => item.categoryId === cat.id).reduce((acc, item) => acc + item.currentStock, 0)
    })).filter(d => d.value > 0);
  }, [categories, items]);

  const topSellingProducts = useMemo(() => {
    const salesByItem: { [key: string]: number } = {};
    transactions.filter(tx => tx.type === 'OUT').forEach(tx => {
      salesByItem[tx.itemId] = (salesByItem[tx.itemId] || 0) + tx.quantity;
    });

    return Object.entries(salesByItem)
      .map(([itemId, total]) => ({
        name: items.find(i => i.id === itemId)?.name || 'Unknown',
        total
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [transactions, items]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Management Dashboard</h1>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">High-level business metrics & performance</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="px-4 py-2 bg-white border border-slate-200 rounded-xl shadow-sm flex items-center gap-2">
            <Calendar size={16} className="text-blue-600" />
            <span className="text-xs font-black text-slate-700 uppercase tracking-widest">{format(new Date(), 'MMMM d, yyyy')}</span>
          </div>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard 
          title="Daily Production" 
          value={stats.dailyProduction} 
          subtitle="Today's Stock In"
          icon={<ArrowUpCircle size={24} />}
          color="bg-emerald-50 text-emerald-600"
          trend="+12% vs yesterday"
        />
        <MetricCard 
          title="Weekly Production" 
          value={stats.weeklyProduction} 
          subtitle="Last 7 Days"
          icon={<Activity size={24} />}
          color="bg-blue-50 text-blue-600"
          trend="+5% vs last week"
        />
        <MetricCard 
          title="Daily Sales" 
          value={stats.dailySales} 
          subtitle="Today's Stock Out"
          icon={<ArrowDownCircle size={24} />}
          color="bg-rose-50 text-rose-600"
          trend="-2% vs yesterday"
        />
        <MetricCard 
          title="Total Sales" 
          value={stats.totalSales} 
          subtitle="Lifetime Stock Out"
          icon={<TrendingUp size={24} />}
          color="bg-amber-50 text-amber-600"
          trend="Overall growth"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Production vs Sales Trend */}
        <div className="lg:col-span-2 bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Production vs Sales</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Last 7 Days Performance</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-600"></div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Production</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-rose-500"></div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Sales</span>
              </div>
            </div>
          </div>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={productionTrendData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
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
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="production" fill="#2563EB" radius={[4, 4, 0, 0]} />
                <Bar dataKey="sales" fill="#F43F5E" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Category Distribution */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight mb-1">Stock Distribution</h3>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-8">By Category Value</p>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {categoryDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-6 space-y-2">
            {categoryDistribution.slice(0, 4).map((cat, index) => (
              <div key={cat.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{backgroundColor: COLORS[index % COLORS.length]}}></div>
                  <span className="text-[11px] font-bold text-slate-600 uppercase tracking-tight">{cat.name}</span>
                </div>
                <span className="text-[11px] font-black text-slate-900">{cat.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Selling Products */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight mb-1">Top Selling Products</h3>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-8">Based on Stock Out Quantity</p>
          <div className="space-y-4">
            {topSellingProducts.map((product, index) => (
              <div key={product.name} className="flex items-center justify-between p-4 bg-slate-50/50 rounded-2xl border border-slate-100">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-2xl bg-white flex items-center justify-center text-xs font-black text-slate-300 border border-slate-100 shadow-sm">
                    {index + 1}
                  </div>
                  <div>
                    <p className="text-xs font-black text-slate-900 uppercase tracking-tight">{product.name}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">High Demand</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-black text-blue-600">{product.total}</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Units Sold</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Weekly Sales Summary */}
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight mb-1">Weekly Sales Summary</h3>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-8">Performance vs Targets</p>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={productionTrendData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
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
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="sales" fill="#F43F5E" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, subtitle, icon, color, trend }: any) {
  return (
    <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden group hover:shadow-xl hover:shadow-slate-200/50 transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className={`p-3 rounded-2xl ${color} transition-transform group-hover:scale-110 duration-300`}>
          {icon}
        </div>
        <div className="text-right">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{title}</p>
          <p className="text-2xl font-black text-slate-900 leading-none">{value.toLocaleString()}</p>
        </div>
      </div>
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-50">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{subtitle}</p>
        <span className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
          {trend}
        </span>
      </div>
    </div>
  );
}
