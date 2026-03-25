import React, { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Item, Category } from '../types';
import { 
  Search, 
  Download, 
  AlertTriangle, 
  CheckCircle2, 
  Package,
  Filter
} from 'lucide-react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { toast } from 'react-hot-toast';

export default function StockTable() {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [filterStatus, setFilterStatus] = useState('ALL');

  useEffect(() => {
    const unsubItems = onSnapshot(collection(db, 'items'), (snap) => {
      setItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item)));
    });
    const unsubCats = onSnapshot(collection(db, 'categories'), (snap) => {
      setCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    });
    return () => {
      unsubItems();
      unsubCats();
    };
  }, []);

  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === 'ALL' || item.categoryId === filterCategory;
    const isLow = item.currentStock <= item.minStock;
    const matchesStatus = filterStatus === 'ALL' || (filterStatus === 'LOW' ? isLow : !isLow);
    return matchesSearch && matchesCategory && matchesStatus;
  });

  const exportToExcel = () => {
    const data = filteredItems.map(item => ({
      'Item Name': item.name,
      'Category': categories.find(c => c.id === item.categoryId)?.name || 'Unknown',
      'Current Stock': item.currentStock,
      'Unit': item.unit,
      'Minimum Stock': item.minStock,
      'Status': item.currentStock <= item.minStock ? 'Low Stock' : 'OK'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Current Stock");
    XLSX.writeFile(wb, `Inventory_Stock_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success('Stock report exported');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Current Stock Inventory</h1>
          <p className="text-slate-500">Real-time monitoring of all items and stock levels</p>
        </div>
        <button 
          onClick={exportToExcel}
          className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
        >
          <Download size={18} />
          <span>Export Stock Report</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Search items..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={18} className="text-slate-400" />
          <select 
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 outline-none"
          >
            <option value="ALL">All Categories</option>
            {categories.map(cat => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-slate-400" />
          <select 
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 outline-none"
          >
            <option value="ALL">All Status</option>
            <option value="LOW">Low Stock Only</option>
            <option value="OK">Healthy Stock Only</option>
          </select>
        </div>
      </div>

      {/* Stock Grid */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <th className="px-6 py-4 font-semibold">Item Name</th>
                <th className="px-6 py-4 font-semibold">Category</th>
                <th className="px-6 py-4 font-semibold">Current Stock</th>
                <th className="px-6 py-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.map((item) => {
                const category = categories.find(c => c.id === item.categoryId);
                const isLow = item.currentStock <= item.minStock;
                return (
                  <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="bg-slate-100 p-2 rounded-lg text-slate-600">
                          <Package size={18} />
                        </div>
                        <span className="font-bold text-slate-900">{item.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-slate-600">{category?.name || 'Unknown'}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`text-lg font-bold ${isLow ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {item.currentStock}
                        </span>
                        <span className="text-xs text-slate-400 font-medium">{item.unit}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {isLow ? (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700 animate-pulse">
                          <AlertTriangle size={14} />
                          Low Stock
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                          <CheckCircle2 size={14} />
                          Healthy
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">
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
