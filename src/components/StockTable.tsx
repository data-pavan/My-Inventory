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
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Current Stock Inventory</h1>
          <p className="text-xs text-slate-500">Real-time monitoring of all items and stock levels</p>
        </div>
        <button 
          onClick={exportToExcel}
          className="flex items-center gap-2 bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors shadow-sm text-sm"
        >
          <Download size={16} />
          <span>Export Stock Report</span>
        </button>
      </div>

      {/* Global Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
              <TrendingUp size={18} />
            </div>
          </div>
          <p className="text-slate-500 text-xs font-medium">Total Stock In</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{globalStats.stockIn}</p>
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-1">In Selected Range</p>
        </div>
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <div className="p-1.5 bg-rose-50 text-rose-600 rounded-lg">
              <TrendingDown size={18} />
            </div>
          </div>
          <p className="text-slate-500 text-xs font-medium">Total Stock Out</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{globalStats.stockOut}</p>
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-1">In Selected Range</p>
        </div>
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-2">
            <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
              <AlertTriangle size={18} />
            </div>
          </div>
          <p className="text-slate-500 text-xs font-medium">Low Stock Items</p>
          <p className="text-xl font-bold text-slate-900 mt-0.5">{globalStats.lowStockCount}</p>
          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-1">Requires Attention</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex flex-col gap-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input 
              type="text" 
              placeholder="Search items..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
            />
          </div>
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 shadow-sm">
            <CalendarIcon size={14} className="text-slate-400" />
            <input 
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="text-xs font-medium outline-none bg-transparent flex-1 min-w-[110px] cursor-pointer"
            />
            <span className="text-slate-400 text-xs">to</span>
            <input 
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="text-xs font-medium outline-none bg-transparent flex-1 min-w-[110px] cursor-pointer"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-slate-400" />
            <select 
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 outline-none text-sm"
            >
              <option value="ALL">All Categories</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-slate-400" />
            <select 
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 outline-none text-sm"
            >
              <option value="ALL">All Status</option>
              <option value="LOW">Low Stock Only</option>
              <option value="OK">Healthy Stock Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Stock Grid */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
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
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-400 italic text-sm">
                    No items found matching your filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
