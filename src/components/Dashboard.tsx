import React, { useState, useEffect } from 'react';
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
  Legend
} from 'recharts';
import { 
  TrendingUp, 
  TrendingDown, 
  AlertTriangle, 
  Package, 
  ArrowRight,
  Download
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { Item, Transaction, Category } from '../types';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';

export default function Dashboard() {
  const [items, setItems] = useState<Item[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubItems = onSnapshot(collection(db, 'items'), (snap) => {
      setItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item)));
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

  const lowStockItems = items.filter(item => item.currentStock <= item.minStock);
  const totalStock = items.reduce((acc, item) => acc + item.currentStock, 0);

  // Calculate Stock Out Today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const stockOutToday = transactions
    .filter(tx => tx.type === 'OUT' && new Date(tx.date).getTime() >= todayStart.getTime())
    .reduce((acc, tx) => acc + tx.quantity, 0);

  // Prepare data for Bar Chart (Transactions last 7 days)
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
      return txDate >= dayStart && txDate <= dayEnd;
    });

    return {
      name: dayName,
      in: dayTxs.filter(tx => tx.type === 'IN').reduce((acc, tx) => acc + tx.quantity, 0),
      out: dayTxs.filter(tx => tx.type === 'OUT').reduce((acc, tx) => acc + tx.quantity, 0),
    };
  });

  // Prepare data for Pie Chart (Category distribution)
  const pieData = categories.map(cat => ({
    name: cat.name,
    value: items.filter(item => item.categoryId === cat.id).length
  })).filter(d => d.value > 0);

  const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(items.map(item => ({
      'Item Name': item.name,
      'Category': categories.find(c => c.id === item.categoryId)?.name || 'Unknown',
      'Current Stock': item.currentStock,
      'Unit': item.unit,
      'Min Stock': item.minStock,
      'Status': item.currentStock <= item.minStock ? 'Low' : 'OK'
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, `Inventory_Summary_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard Overview</h1>
          <p className="text-slate-500">Real-time inventory insights and analytics</p>
        </div>
        <button 
          onClick={exportToExcel}
          className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
        >
          <Download size={18} />
          <span>Export Summary</span>
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-blue-50 p-3 rounded-xl text-blue-600">
              <Package size={24} />
            </div>
          </div>
          <h3 className="text-slate-500 text-sm font-medium">Total Items</h3>
          <p className="text-2xl font-bold text-slate-900 mt-1">{items.length}</p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-emerald-50 p-3 rounded-xl text-emerald-600">
              <TrendingUp size={24} />
            </div>
            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">Active</span>
          </div>
          <h3 className="text-slate-500 text-sm font-medium">Total Stock</h3>
          <p className="text-2xl font-bold text-slate-900 mt-1">{totalStock}</p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-amber-50 p-3 rounded-xl text-amber-600">
              <AlertTriangle size={24} />
            </div>
            <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-1 rounded-full">{lowStockItems.length} Items</span>
          </div>
          <h3 className="text-slate-500 text-sm font-medium">Low Stock Alerts</h3>
          <p className="text-2xl font-bold text-slate-900 mt-1">{lowStockItems.length}</p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div className="bg-rose-50 p-3 rounded-xl text-rose-600">
              <TrendingDown size={24} />
            </div>
            <span className="text-xs font-semibold text-rose-600 bg-rose-50 px-2 py-1 rounded-full">Today</span>
          </div>
          <h3 className="text-slate-500 text-sm font-medium">Stock Out</h3>
          <p className="text-2xl font-bold text-slate-900 mt-1">{stockOutToday}</p>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Stock Movement (Weekly)</h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748B', fontSize: 12}} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748B', fontSize: 12}} />
                <Tooltip 
                  contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                />
                <Legend iconType="circle" wrapperStyle={{paddingTop: '20px'}} />
                <Bar dataKey="in" name="Stock IN" fill="#2563EB" radius={[4, 4, 0, 0]} />
                <Bar dataKey="out" name="Stock OUT" fill="#EF4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-bold text-slate-900 mb-6">Category Distribution</h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent Transactions & Low Stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-lg font-bold text-slate-900">Recent Transactions</h3>
            <button className="text-blue-600 text-sm font-semibold hover:text-blue-700 flex items-center gap-1">
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
                {transactions.slice(0, 10).map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 text-sm font-medium text-slate-900">{tx.voucherNo}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {items.find(i => i.id === tx.itemId)?.name || 'Unknown Item'}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        tx.type === 'IN' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
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
              {lowStockItems.length} Critical
            </span>
          </div>
          <div className="p-6 space-y-4">
            {lowStockItems.slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="bg-white p-2 rounded-lg shadow-sm">
                    <Package size={20} className="text-slate-400" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">{item.name}</h4>
                    <p className="text-xs text-slate-500">Min: {item.minStock} {item.unit}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-rose-600">{item.currentStock} {item.unit}</p>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">Current</p>
                </div>
              </div>
            ))}
            {lowStockItems.length === 0 && (
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
