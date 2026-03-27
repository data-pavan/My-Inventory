import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { Item, Category, Transaction } from '../types';
import { 
  Search, 
  Download, 
  AlertTriangle, 
  CheckCircle2, 
  Package,
  Filter,
  Calendar as CalendarIcon,
  TrendingUp,
  TrendingDown
} from 'lucide-react';
import { format, startOfDay, endOfDay, parseISO } from 'date-fns';
import * as XLSX from 'xlsx';
import { toast } from 'react-hot-toast';

export default function StockTable() {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [dateRange, setDateRange] = useState({
    start: format(new Date(), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd')
  });

  useEffect(() => {
    const unsubItems = onSnapshot(collection(db, 'items'), (snap) => {
      setItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item)));
    });
    const unsubCats = onSnapshot(collection(db, 'categories'), (snap) => {
      setCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    });
    const unsubTransactions = onSnapshot(
      query(collection(db, 'transactions'), orderBy('date', 'desc')), 
      (snap) => {
        setTransactions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
      }
    );
    return () => {
      unsubItems();
      unsubCats();
      unsubTransactions();
    };
  }, []);

  const rangeStart = startOfDay(parseISO(dateRange.start)).getTime();
  const rangeEnd = endOfDay(parseISO(dateRange.end)).getTime();

  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === 'ALL' || item.categoryId === filterCategory;
    const isLow = item.currentStock <= item.minStock;
    const matchesStatus = filterStatus === 'ALL' || (filterStatus === 'LOW' ? isLow : !isLow);
    return matchesSearch && matchesCategory && matchesStatus;
  });

  const globalStats = {
    totalStock: items.reduce((acc, item) => acc + item.currentStock, 0),
    stockIn: transactions
      .filter(tx => tx.type === 'IN' && new Date(tx.date).getTime() >= rangeStart && new Date(tx.date).getTime() <= rangeEnd)
      .reduce((acc, tx) => acc + tx.quantity, 0),
    stockOut: transactions
      .filter(tx => tx.type === 'OUT' && new Date(tx.date).getTime() >= rangeStart && new Date(tx.date).getTime() <= rangeEnd)
      .reduce((acc, tx) => acc + tx.quantity, 0),
    lowStockCount: items.filter(item => item.currentStock <= item.minStock).length
  };

  const exportToExcel = () => {
    const data = filteredItems.map(item => {
      const itemTxs = transactions.filter(tx => tx.itemId === item.id);
      const stockIn = itemTxs
        .filter(tx => tx.type === 'IN' && new Date(tx.date).getTime() >= rangeStart && new Date(tx.date).getTime() <= rangeEnd)
        .reduce((acc, tx) => acc + tx.quantity, 0);
      const stockOut = itemTxs
        .filter(tx => tx.type === 'OUT' && new Date(tx.date).getTime() >= rangeStart && new Date(tx.date).getTime() <= rangeEnd)
        .reduce((acc, tx) => acc + tx.quantity, 0);

      return {
        'Item Name': item.name,
        'Category': categories.find(c => c.id === item.categoryId)?.name || 'Unknown',
        'Stock IN (Period)': stockIn,
        'Stock OUT (Period)': stockOut,
        'Current Stock': item.currentStock,
        'Unit': item.unit,
        'Minimum Stock': item.minStock,
        'Status': item.currentStock <= item.minStock ? 'Low Stock' : 'OK'
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Current Stock");
    XLSX.writeFile(wb, `Inventory_Stock_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success('Stock report exported');
  };

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Current Stock Inventory</h1>
          <p className="text-xs text-slate-500">Real-time monitoring of all items and stock levels</p>
        </div>
        <button 
          onClick={exportToExcel}
          className="flex items-center justify-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors shadow-sm text-sm font-medium"
        >
          <Download size={18} />
          <span>Export Report</span>
        </button>
      </div>

      {/* Global Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
            <TrendingUp size={20} />
          </div>
          <div>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Stock In</p>
            <p className="text-xl font-bold text-slate-900">{globalStats.stockIn}</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
            <TrendingDown size={20} />
          </div>
          <div>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Stock Out</p>
            <p className="text-xl font-bold text-slate-900">{globalStats.stockOut}</p>
          </div>
        </div>
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex items-center gap-4">
          <div className={`p-3 rounded-xl ${globalStats.lowStockCount > 0 ? 'bg-rose-50 text-rose-600 animate-pulse' : 'bg-amber-50 text-amber-600'}`}>
            <AlertTriangle size={20} />
          </div>
          <div>
            <p className="text-slate-500 text-[10px] font-bold uppercase tracking-wider">Low Stock</p>
            <p className="text-xl font-bold text-slate-900">{globalStats.lowStockCount}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 space-y-3">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
          <div className="lg:col-span-5 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder="Search items..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
            />
          </div>
          
          <div className="lg:col-span-4 flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <CalendarIcon size={16} className="text-slate-400 shrink-0" />
              <div className="flex items-center gap-1 w-full">
                <input 
                  type="date"
                  value={dateRange.start}
                  onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                  className="bg-transparent border-none p-0 text-xs focus:ring-0 w-full outline-none"
                />
                <span className="text-slate-400 text-xs">to</span>
                <input 
                  type="date"
                  value={dateRange.end}
                  onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                  className="bg-transparent border-none p-0 text-xs focus:ring-0 w-full outline-none"
                />
              </div>
            </div>
          </div>

          <div className="lg:col-span-3 grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-2">
              <Filter size={14} className="text-slate-400 shrink-0" />
              <select 
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="bg-transparent border-none p-0 focus:ring-0 w-full text-[10px] font-bold uppercase outline-none"
              >
                <option value="ALL">All Categories</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-2">
              <AlertTriangle size={14} className="text-slate-400 shrink-0" />
              <select 
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="bg-transparent border-none p-0 focus:ring-0 w-full text-[10px] font-bold uppercase outline-none"
              >
                <option value="ALL">All Status</option>
                <option value="LOW">Low Stock</option>
                <option value="OK">Healthy</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile View - Cards */}
      <div className="md:hidden space-y-4 px-1">
        {filteredItems.length === 0 ? (
          <div className="bg-white p-12 rounded-2xl border-2 border-dashed border-slate-100 text-center">
            <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Package className="text-slate-300" size={32} />
            </div>
            <p className="text-slate-600 font-bold">No items found</p>
            <p className="text-slate-400 text-xs mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const category = categories.find(c => c.id === item.categoryId);
            const isLow = item.currentStock <= item.minStock;
            
            const itemTxs = transactions.filter(tx => tx.itemId === item.id);
            const stockIn = itemTxs
              .filter(tx => tx.type === 'IN' && new Date(tx.date).getTime() >= rangeStart && new Date(tx.date).getTime() <= rangeEnd)
              .reduce((acc, tx) => acc + tx.quantity, 0);
            const stockOut = itemTxs
              .filter(tx => tx.type === 'OUT' && new Date(tx.date).getTime() >= rangeStart && new Date(tx.date).getTime() <= rangeEnd)
              .reduce((acc, tx) => acc + tx.quantity, 0);

            return (
              <div 
                key={item.id} 
                className={`bg-white rounded-2xl border-2 transition-all active:scale-[0.98] overflow-hidden ${
                  isLow ? 'border-rose-100 bg-rose-50/5 shadow-lg shadow-rose-500/5' : 'border-slate-50 shadow-sm'
                }`}
              >
                <div className="p-4">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                        isLow ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-600'
                      }`}>
                        <Package size={22} />
                      </div>
                      <div>
                        <h3 className="font-bold text-slate-900 text-sm leading-tight">{item.name}</h3>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mt-0.5">{category?.name || 'Unknown'}</p>
                      </div>
                    </div>
                    {isLow ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black bg-rose-100 text-rose-700 uppercase tracking-widest animate-pulse">
                        <AlertTriangle size={10} />
                        Low Stock
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-black bg-emerald-100 text-emerald-700 uppercase tracking-widest">
                        <CheckCircle2 size={10} />
                        Healthy
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50/50 rounded-2xl border border-slate-100/50">
                    <div className="text-center">
                      <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block mb-1">In</span>
                      <span className="text-sm font-black text-emerald-600">{stockIn}</span>
                    </div>
                    <div className="text-center border-x border-slate-200/50">
                      <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block mb-1">Out</span>
                      <span className="text-sm font-black text-rose-600">{stockOut}</span>
                    </div>
                    <div className="text-center">
                      <span className="text-[9px] text-slate-400 font-black uppercase tracking-widest block mb-1">Current</span>
                      <div className="flex items-center justify-center gap-0.5">
                        <span className={`text-sm font-black ${isLow ? 'text-rose-600' : 'text-slate-900'}`}>{item.currentStock}</span>
                        <span className="text-[9px] text-slate-400 font-bold">{item.unit}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between px-1">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Min Stock: {item.minStock}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Scheduled:</span>
                      <span className="text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-lg">{item.scheduledStock || 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop View - Table */}
      <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
                <th className="px-4 py-3 font-semibold">Item Name</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold text-center">Stock IN</th>
                <th className="px-4 py-3 font-semibold text-center">Stock OUT</th>
                <th className="px-4 py-3 font-semibold">Current Stock</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.map((item) => {
                const category = categories.find(c => c.id === item.categoryId);
                const isLow = item.currentStock <= item.minStock;
                
                const itemTxs = transactions.filter(tx => tx.itemId === item.id);
                const stockIn = itemTxs
                  .filter(tx => tx.type === 'IN' && new Date(tx.date).getTime() >= rangeStart && new Date(tx.date).getTime() <= rangeEnd)
                  .reduce((acc, tx) => acc + tx.quantity, 0);
                const stockOut = itemTxs
                  .filter(tx => tx.type === 'OUT' && new Date(tx.date).getTime() >= rangeStart && new Date(tx.date).getTime() <= rangeEnd)
                  .reduce((acc, tx) => acc + tx.quantity, 0);

                return (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="bg-slate-100 p-1.5 rounded-lg text-slate-600">
                          <Package size={16} />
                        </div>
                        <span className="font-bold text-slate-900 text-sm">{item.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-slate-600">{category?.name || 'Unknown'}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-bold text-emerald-600 text-sm">{stockIn}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-bold text-rose-600 text-sm">{stockOut}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-base font-bold ${isLow ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {item.currentStock}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">{item.unit}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {isLow ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 animate-pulse">
                          <AlertTriangle size={12} />
                          Low Stock
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700">
                          <CheckCircle2 size={12} />
                          Healthy
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
