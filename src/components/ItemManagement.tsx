import React, { useState, useEffect } from 'react';
import { collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Item, Category, OperationType, Transaction } from '../types';
import { handleFirestoreError } from '../utils/error-handler';
import { toast } from 'react-hot-toast';
import { Plus, Edit2, Trash2, X, Save, Package, Tag, Ruler, Search, Filter, History, RefreshCw, AlertCircle } from 'lucide-react';

export default function ItemManagement() {
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    categoryId: '',
    unit: 'pcs',
    minStock: 10,
    initialStock: 0,
    currentStock: 0,
    scheduledStock: 0,
    isStockable: true
  });
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('ALL');
  const [auditItem, setAuditItem] = useState<Item | null>(null);
  const [auditData, setAuditData] = useState<{
    transactions: Transaction[];
    calculatedStock: number;
    discrepancy: number;
    loading: boolean;
  } | null>(null);

  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<string | null>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.categoryId) {
      toast.error('Please select a category');
      return;
    }
    setLoading(true);
    try {
      if (editingItem) {
        // Calculate the difference in initial stock to adjust current stock
        const oldInitialStock = Number(editingItem.initialStock) || 0;
        const oldCurrentStock = Number(editingItem.currentStock) || 0;
        const newInitialStock = Number(formData.initialStock) || 0;
        const initialStockDiff = newInitialStock - oldInitialStock;
        const newCurrentStock = oldCurrentStock + initialStockDiff;
        
        const updateData = {
          ...formData,
          currentStock: newCurrentStock
        };
        
        await updateDoc(doc(db, 'items', editingItem.id), updateData);
        toast.success('Item updated successfully');
      } else {
        // For new items, current stock starts as initial stock
        const newItemData = {
          ...formData,
          currentStock: formData.initialStock,
          scheduledStock: 0
        };
        await addDoc(collection(db, 'items'), newItemData);
        toast.success('Item added successfully');
      }
      closeModal();
    } catch (error) {
      handleFirestoreError(error, editingItem ? OperationType.UPDATE : OperationType.CREATE, 'items');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;
    setLoading(true);
    try {
      await deleteDoc(doc(db, 'items', itemToDelete));
      toast.success('Item deleted successfully');
      setIsDeleteModalOpen(false);
      setItemToDelete(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'items');
    } finally {
      setLoading(false);
    }
  };

  const initiateDelete = (id: string) => {
    setItemToDelete(id);
    setIsDeleteModalOpen(true);
  };

  const handleAudit = async (item: Item) => {
    setAuditItem(item);
    setAuditData({ transactions: [], calculatedStock: 0, discrepancy: 0, loading: true });
    try {
      const q = query(collection(db, 'transactions'), where('itemId', '==', item.id));
      const snap = await getDocs(q);
      const txs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      
      let runningBalance = Number(item.initialStock || 0);
      const sortedTxs = txs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      const txsWithBalance = sortedTxs.map(tx => {
        const qty = Number(tx.quantity || 0);
        if (!isNaN(qty)) {
          if (tx.type === 'IN' || tx.type === 'FACTORY_IN') {
            runningBalance += qty;
          } else if (tx.type === 'OUT' || tx.type === 'SCHEDULED') {
            runningBalance -= qty;
          }
        }
        return { ...tx, balanceAfter: runningBalance };
      });

      const currentStock = Number(item.currentStock || 0);
      setAuditData({
        transactions: txsWithBalance,
        calculatedStock: runningBalance,
        discrepancy: runningBalance - currentStock,
        loading: false
      });
    } catch (error) {
      toast.error('Failed to audit stock');
      setAuditData(null);
      setAuditItem(null);
    }
  };

  const fixStock = async () => {
    if (!auditItem || !auditData) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, 'items', auditItem.id), {
        currentStock: auditData.calculatedStock
      });
      toast.success('Stock corrected successfully');
      setAuditItem(null);
      setAuditData(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'items/fix-stock');
    } finally {
      setLoading(false);
    }
  };

  const openModal = (item?: Item) => {
    if (item) {
      setEditingItem(item);
      setFormData({
        name: item.name,
        categoryId: item.categoryId,
        unit: item.unit,
        minStock: item.minStock,
        initialStock: item.initialStock || 0,
        currentStock: item.currentStock,
        scheduledStock: item.scheduledStock || 0,
        isStockable: item.isStockable !== undefined ? item.isStockable : true
      });
    } else {
      setEditingItem(null);
      setFormData({
        name: '',
        categoryId: categories[0]?.id || '',
        unit: 'pcs',
        minStock: 10,
        initialStock: 0,
        currentStock: 0,
        scheduledStock: 0,
        isStockable: true
      });
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingItem(null);
  };

  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === 'ALL' || item.categoryId === filterCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-4 pb-20 md:pb-0">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Product Management</h1>
          <p className="text-xs text-slate-500">Manage your inventory items and stock levels</p>
        </div>
        <button 
          onClick={() => openModal()}
          className="flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20 text-sm font-medium"
        >
          <Plus size={18} />
          <span>Add Product</span>
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-4 mx-1 sm:mx-0">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-8 relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={18} />
            <input 
              type="text" 
              placeholder="Search products..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:bg-white focus:border-blue-500 transition-all text-sm font-medium"
            />
          </div>
          <div className="md:col-span-4 flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3">
            <Filter size={18} className="text-slate-400" />
            <select 
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="bg-transparent border-none p-0 focus:ring-0 w-full text-sm font-bold text-slate-700 outline-none appearance-none"
            >
              <option value="ALL">All Categories</option>
              {categories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
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
            <p className="text-slate-600 font-bold">No products found</p>
            <p className="text-slate-400 text-xs mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const category = categories.find(c => c.id === item.categoryId);
            const currentStock = Number(item.currentStock) || 0;
            const minStock = Number(item.minStock) || 0;
            const isLowStock = currentStock <= minStock;
            return (
              <div key={item.id} className="bg-white rounded-2xl border-2 border-slate-50 p-4 shadow-sm transition-all active:scale-[0.98]">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-600 shrink-0">
                      <Package size={22} />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm leading-tight">{item.name}</h3>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black bg-slate-100 text-slate-800 uppercase tracking-widest mt-1">
                        {category?.name || 'Unknown'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => handleAudit(item)}
                      className="p-2 text-amber-600 hover:bg-amber-50 rounded-xl transition-colors"
                      title="Audit Stock"
                    >
                      <History size={20} />
                    </button>
                    <button 
                      onClick={() => openModal(item)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                    >
                      <Edit2 size={20} />
                    </button>
                    <button 
                      onClick={() => initiateDelete(item.id)}
                      className="p-2 text-rose-600 hover:bg-rose-50 rounded-xl transition-colors"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 p-3 bg-slate-50/50 rounded-2xl border border-slate-100/50">
                  <div className="text-center">
                    <span className="text-[8px] text-slate-400 font-black uppercase tracking-widest block mb-1">Initial</span>
                    <span className="text-xs font-black text-slate-600">
                      {Number(item.initialStock) || 0}
                    </span>
                  </div>
                  <div className="text-center border-l border-slate-200/50">
                    <span className="text-[8px] text-slate-400 font-black uppercase tracking-widest block mb-1">Available</span>
                    <span className={`text-xs font-black ${isLowStock ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {Number(item.currentStock) || 0}
                    </span>
                  </div>
                  <div className="text-center border-x border-slate-200/50">
                    <span className="text-[8px] text-slate-400 font-black uppercase tracking-widest block mb-1">Scheduled</span>
                    <span className="text-xs font-black text-amber-600">
                      {Number(item.scheduledStock) || 0}
                    </span>
                  </div>
                  <div className="text-center">
                    <span className="text-[8px] text-slate-400 font-black uppercase tracking-widest block mb-1">Min</span>
                    <span className="text-xs font-black text-slate-900">{Number(item.minStock) || 0}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Desktop View - Table */}
      <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
              <th className="px-4 py-3 font-semibold">Item Name</th>
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">Initial Stock</th>
              <th className="px-4 py-3 font-semibold">Available Stock</th>
              <th className="px-4 py-3 font-semibold">Scheduled</th>
              <th className="px-4 py-3 font-semibold">Unit</th>
              <th className="px-4 py-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredItems.map((item) => {
              const category = categories.find(c => c.id === item.categoryId);
              const currentStock = Number(item.currentStock) || 0;
              const minStock = Number(item.minStock) || 0;
              const isLowStock = currentStock <= minStock;
              return (
                <tr key={item.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="bg-slate-100 p-1.5 rounded-lg text-slate-600 group-hover:bg-white group-hover:shadow-sm transition-all">
                        <Package size={16} />
                      </div>
                      <span className="font-medium text-slate-900 text-sm">{item.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-800">
                      {category?.name || 'Unknown'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-slate-600 text-sm font-medium">
                      {Number(item.initialStock) || 0} {item.unit}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col">
                      <span className={`font-bold text-sm ${isLowStock ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {Number(item.currentStock) || 0} {item.unit}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold text-amber-600 text-sm">
                      {Number(item.scheduledStock) || 0} {item.unit}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-sm">{item.unit}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => handleAudit(item)}
                        className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                        title="Audit Stock"
                      >
                        <History size={16} />
                      </button>
                      <button 
                        onClick={() => openModal(item)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => initiateDelete(item.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Stock Audit Modal */}
      {auditItem && auditData && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in duration-300 flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
                  <History size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Stock Audit</h3>
                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">{auditItem.name}</p>
                </div>
              </div>
              <button onClick={() => { setAuditItem(null); setAuditData(null); }} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all">
                <X size={24} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
              {auditData.loading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <RefreshCw className="animate-spin text-blue-600" size={48} />
                  <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">Analyzing Transactions...</p>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest block mb-1">Initial Stock</span>
                      <span className="text-xl font-black text-slate-900">{auditItem.initialStock || 0}</span>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest block mb-1">Current Stock</span>
                      <span className="text-xl font-black text-slate-900">{auditItem.currentStock}</span>
                    </div>
                    <div className="p-4 bg-blue-50 rounded-2xl border-blue-100">
                      <span className="text-[10px] text-blue-400 font-black uppercase tracking-widest block mb-1">Calculated</span>
                      <span className="text-xl font-black text-blue-600">{isNaN(auditData.calculatedStock) ? '0' : auditData.calculatedStock}</span>
                    </div>
                  </div>

                  {auditData.discrepancy !== 0 && !isNaN(auditData.discrepancy) ? (
                    <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-start gap-3">
                      <AlertCircle className="text-rose-600 shrink-0" size={20} />
                      <div>
                        <p className="text-sm font-bold text-rose-900">Discrepancy Detected</p>
                        <p className="text-xs text-rose-700 mt-1">
                          The current stock ({auditItem.currentStock}) does not match the calculated stock ({auditData.calculatedStock}) based on transaction history.
                          Difference: <span className="font-black">{auditData.discrepancy > 0 ? `+${auditData.discrepancy}` : auditData.discrepancy}</span>
                        </p>
                      </div>
                    </div>
                  ) : isNaN(auditData.discrepancy) ? (
                    <div className="p-4 bg-amber-50 border border-amber-100 rounded-2xl flex items-start gap-3">
                      <AlertCircle className="text-amber-600 shrink-0" size={20} />
                      <div>
                        <p className="text-sm font-bold text-amber-900">Audit Error</p>
                        <p className="text-xs text-amber-700 mt-1">Could not calculate discrepancy due to invalid data in transactions.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-start gap-3">
                      <RefreshCw className="text-emerald-600 shrink-0" size={20} />
                      <div>
                        <p className="text-sm font-bold text-emerald-900">Stock is Correct</p>
                        <p className="text-xs text-emerald-700 mt-1">The current stock matches the transaction history perfectly.</p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Transaction History</h4>
                    <div className="border border-slate-100 rounded-2xl overflow-hidden">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-[10px] text-slate-500 uppercase font-black">
                          <tr>
                            <th className="px-4 py-2">Date</th>
                            <th className="px-4 py-2">Type</th>
                            <th className="px-4 py-2">Voucher</th>
                            <th className="px-4 py-2 text-right">Qty</th>
                            <th className="px-4 py-2 text-right">Balance</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {auditData.transactions.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-4 py-8 text-center text-slate-400 italic">No transactions found for this item.</td>
                            </tr>
                          ) : (
                            [...auditData.transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).map(tx => (
                              <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-4 py-2 text-slate-600">{new Date(tx.date).toLocaleDateString()}</td>
                                <td className="px-4 py-2">
                                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                                    tx.type === 'IN' || tx.type === 'FACTORY_IN' ? 'bg-emerald-100 text-emerald-700' : 
                                    tx.type === 'OUT' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                                  }`}>
                                    {tx.type}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-slate-900 font-medium">{tx.voucherNo}</td>
                                <td className={`px-4 py-2 text-right font-bold ${
                                  tx.type === 'IN' || tx.type === 'FACTORY_IN' ? 'text-emerald-600' : 
                                  tx.type === 'OUT' ? 'text-rose-600' : 'text-slate-900'
                                }`}>
                                  {tx.type === 'OUT' ? '-' : '+'}{tx.quantity}
                                </td>
                                <td className="px-4 py-2 text-right font-black text-slate-900">
                                  {(tx as any).balanceAfter}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50 flex gap-3">
              <button 
                onClick={() => { setAuditItem(null); setAuditData(null); }}
                className="flex-1 px-6 py-4 rounded-2xl text-sm font-black text-slate-500 bg-white border-2 border-slate-200 hover:bg-slate-100 transition-all uppercase tracking-widest"
              >
                Close
              </button>
              {auditData && auditData.discrepancy !== 0 && !auditData.loading && (
                <button 
                  onClick={fixStock}
                  disabled={loading}
                  className="flex-[2] px-6 py-4 rounded-2xl text-sm font-black text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 transition-all shadow-lg shadow-amber-600/20 uppercase tracking-widest flex items-center justify-center gap-2"
                >
                  {loading ? <RefreshCw className="animate-spin" size={18} /> : <RefreshCw size={18} />}
                  <span>Fix Discrepancy</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-300">
            <div className="p-6 border-b border-slate-100 bg-rose-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-rose-600 text-white rounded-lg">
                  <Trash2 size={24} />
                </div>
                <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Delete Product</h3>
              </div>
              <button onClick={() => setIsDeleteModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={24} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600 font-medium">
                Are you sure you want to delete this product? This action cannot be undone and will remove all stock history.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setIsDeleteModalOpen(false)}
                  className="flex-1 px-4 py-3 border-2 border-slate-100 text-slate-500 font-black uppercase tracking-widest rounded-xl hover:bg-slate-50 transition-all text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={loading}
                  className="flex-1 bg-rose-600 text-white font-black uppercase tracking-widest py-3 rounded-xl hover:bg-rose-700 transition-all disabled:opacity-50 flex items-center justify-center text-xs shadow-lg shadow-rose-600/20"
                >
                  {loading ? (
                    <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    'Delete'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in slide-in-from-bottom sm:zoom-in duration-300 max-h-[95vh] flex flex-col">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center">
                  {editingItem ? <Edit2 size={24} /> : <Plus size={24} />}
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                    {editingItem ? 'Edit Product' : 'Add Product'}
                  </h3>
                  <p className="text-[11px] text-slate-500 font-bold uppercase tracking-widest">Inventory Management</p>
                </div>
              </div>
              <button onClick={closeModal} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all">
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Product Identity</label>
                  <div className="relative group">
                    <Package className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={20} />
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 focus:bg-white outline-none transition-all font-bold text-slate-900"
                      placeholder="e.g. Steel Pipe 2 inch"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Classification</label>
                    <div className="relative group">
                      <Tag className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={20} />
                      <select
                        required
                        value={formData.categoryId}
                        onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 focus:bg-white outline-none transition-all appearance-none font-bold text-slate-900"
                      >
                        <option value="">Select Category</option>
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Measurement</label>
                    <div className="relative group">
                      <Ruler className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={20} />
                      <select
                        required
                        value={formData.unit}
                        onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 focus:bg-white outline-none transition-all appearance-none font-bold text-slate-900"
                      >
                        <option value="pcs">Pieces (pcs)</option>
                        <option value="pair">Pairs (pair)</option>
                        <option value="kg">Kilograms (kg)</option>
                        <option value="meter">Meters (m)</option>
                        <option value="liter">Liters (l)</option>
                        <option value="box">Boxes (box)</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Min. Threshold</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={formData.minStock}
                      onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })}
                      className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 focus:bg-white outline-none transition-all font-bold text-slate-900"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Initial Stock</label>
                    <input
                      type="number"
                      required
                      min="0"
                      value={formData.initialStock}
                      disabled={!formData.isStockable}
                      onChange={(e) => setFormData({ ...formData, initialStock: parseInt(e.target.value) || 0 })}
                      className={`w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 focus:bg-white outline-none transition-all font-bold text-slate-900 ${!formData.isStockable ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <input
                    type="checkbox"
                    id="isStockable"
                    checked={formData.isStockable}
                    onChange={(e) => setFormData({ ...formData, isStockable: e.target.checked })}
                    className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                  />
                  <label htmlFor="isStockable" className="text-sm font-bold text-slate-700">This is a stockable product</label>
                </div>
              </div>

              <div className="flex gap-3 pt-4 sticky bottom-0 bg-white pb-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-4 border-2 border-slate-100 text-slate-500 font-black uppercase tracking-widest rounded-2xl hover:bg-slate-50 transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-[2] bg-blue-600 text-white font-black uppercase tracking-widest py-4 px-6 rounded-2xl hover:bg-blue-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-xl shadow-blue-600/20 active:scale-95"
                >
                  {loading ? (
                    <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <Save size={20} />
                      <span>{editingItem ? 'Update' : 'Save'}</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
