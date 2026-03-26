import React, { useState, useEffect } from 'react';
import { 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  onSnapshot, 
  query, 
  orderBy, 
  increment,
  runTransaction,
  Timestamp,
  writeBatch,
  getDocs
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Transaction, Item, Category, TransactionType, OperationType, UserProfile } from '../types';
import { handleFirestoreError } from '../utils/error-handler';
import { toast } from 'react-hot-toast';
import { 
  Plus, 
  ArrowDownCircle, 
  ArrowUpCircle, 
  Clock,
  Search, 
  Filter, 
  Download, 
  Calendar as CalendarIcon,
  Package,
  MapPin,
  User as UserIcon,
  X,
  Trash2,
  AlertTriangle,
  Edit2
} from 'lucide-react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';

export default function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [modalType, setModalType] = useState<TransactionType>('IN');
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [dateRange, setDateRange] = useState({
    start: '',
    end: ''
  });

  const [confirmAction, setConfirmAction] = useState<{
    type: 'DELETE';
    tx?: Transaction;
  } | null>(null);

  const [formData, setFormData] = useState({
    invoiceNo: '',
    sourceDestination: '',
    location: '',
    salesPerson: '',
    date: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    items: [{ categoryId: 'ALL', itemId: '', quantity: 1, fromScheduled: false, originalTxId: '' }]
  });

  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedTxIds, setSelectedTxIds] = useState<string[]>([]);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isBatchDispatchModalOpen, setIsBatchDispatchModalOpen] = useState(false);
  const [batchDispatchDate, setBatchDispatchDate] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [batchFormData, setBatchFormData] = useState({
    invoiceNo: '',
    sourceDestination: '',
    location: '',
    updateInvoice: false,
    updateSourceDest: false,
    updateLocation: false
  });

  useEffect(() => {
    const unsubTx = onSnapshot(query(collection(db, 'transactions'), orderBy('date', 'desc')), (snap) => {
      setTransactions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
    });
    const unsubItems = onSnapshot(collection(db, 'items'), (snap) => {
      setItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item)));
    });
    const unsubCats = onSnapshot(collection(db, 'categories'), (snap) => {
      setCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    });
    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(doc => doc.data() as UserProfile));
    });
    return () => {
      unsubTx();
      unsubItems();
      unsubCats();
      unsubUsers();
    };
  }, []);

  const generateVoucherNo = () => {
    const prefix = modalType === 'IN' ? 'VIN' : modalType === 'OUT' ? 'VOUT' : 'VSCH';
    const lastNum = transactions.length + 1;
    return `${prefix}-${String(lastNum).padStart(4, '0')}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.items.some(i => !i.itemId)) return toast.error('Please select an item for all entries');
    
    setLoading(true);
    try {
      await runTransaction(db, async (transaction) => {
        const voucherNo = editingTransaction ? editingTransaction.voucherNo : generateVoucherNo();
        
        // 1. Perform all reads first
        const itemSnaps = new Map<string, any>();
        for (const entry of formData.items) {
          if (!itemSnaps.has(entry.itemId)) {
            const itemRef = doc(db, 'items', entry.itemId);
            const itemSnap = await transaction.get(itemRef);
            if (!itemSnap.exists()) throw new Error(`Item ${entry.itemId} does not exist!`);
            itemSnaps.set(entry.itemId, { ref: itemRef, data: itemSnap.data() });
          }
        }

        // 2. Perform all calculations and writes
        for (const entry of formData.items) {
          const itemInfo = itemSnaps.get(entry.itemId);
          const currentStock = itemInfo.data.currentStock;
          const scheduledStock = itemInfo.data.scheduledStock || 0;
          
          let oldStock = currentStock;
          let oldScheduled = scheduledStock;

          // Find if we are updating an existing transaction
          const targetTxId = entry.originalTxId || (editingTransaction && entry.itemId === editingTransaction.itemId ? editingTransaction.id : null);
          let originalTx: Transaction | undefined;
          
          if (targetTxId) {
            // We need the original transaction data to reverse its effect
            // Since we can't easily get it inside the loop without more reads, 
            // we'll assume it's in our local transactions state or we should have read it.
            // For simplicity and correctness, let's use the data from the state.
            originalTx = transactions.find(t => t.id === targetTxId);
          }

          // Reverse old effect if editing
          if (originalTx) {
            if (originalTx.type === 'IN') {
              oldStock -= originalTx.quantity;
            } else if (originalTx.type === 'OUT') {
              oldStock += originalTx.quantity;
              if (originalTx.fromScheduled) {
                oldScheduled += originalTx.quantity;
              }
            } else if (originalTx.type === 'SCHEDULED') {
              oldStock += originalTx.quantity;
              oldScheduled -= originalTx.quantity;
            }
          }

          // Apply new effect
          let newStock = oldStock;
          let newScheduledStock = oldScheduled;

          if (modalType === 'IN') {
            newStock = oldStock + entry.quantity;
          } else if (modalType === 'OUT') {
            newStock = oldStock - entry.quantity;
            if (entry.fromScheduled) {
              // If it was already scheduled, we don't change scheduledStock here 
              // because we are converting it.
              // Wait, if we are converting SCHEDULED -> OUT:
              // Original: Stock - Q, Scheduled + Q
              // Reverse: Stock + Q, Scheduled - Q
              // Apply OUT: Stock - Q
              // Result: Stock - Q, Scheduled - Q (relative to original state)
              // This is correct.
            }
          } else if (modalType === 'SCHEDULED') {
            newStock = oldStock - entry.quantity;
            newScheduledStock = oldScheduled + entry.quantity;
          }
          
          if (newStock < 0) throw new Error(`Insufficient stock for ${itemInfo.data.name}!`);
          if (newScheduledStock < 0) throw new Error(`Invalid scheduled stock for ${itemInfo.data.name}!`);

          if (targetTxId) {
            transaction.update(doc(db, 'transactions', targetTxId), {
              itemId: entry.itemId,
              quantity: entry.quantity,
              invoiceNo: formData.invoiceNo,
              sourceDestination: formData.sourceDestination,
              location: formData.location,
              salesPerson: formData.salesPerson,
              date: new Date(formData.date).toISOString(),
              type: modalType,
              fromScheduled: entry.fromScheduled
            });
          } else {
            const txData = {
              itemId: entry.itemId,
              quantity: entry.quantity,
              invoiceNo: formData.invoiceNo,
              sourceDestination: formData.sourceDestination,
              location: formData.location,
              salesPerson: formData.salesPerson,
              voucherNo,
              type: modalType,
              createdBy: auth.currentUser?.uid,
              date: new Date(formData.date).toISOString(),
              fromScheduled: entry.fromScheduled
            };
            transaction.set(doc(collection(db, 'transactions')), txData);
          }
          
          transaction.update(itemInfo.ref, { 
            currentStock: newStock,
            scheduledStock: newScheduledStock
          });

          // Update local map data so subsequent items for the same itemId use updated values
          itemInfo.data.currentStock = newStock;
          itemInfo.data.scheduledStock = newScheduledStock;
        }
      });

      toast.success(`Transaction ${editingTransaction ? 'updated' : 'recorded'} successfully`);
      closeModal();
    } catch (error) {
      handleFirestoreError(error, editingTransaction ? OperationType.UPDATE : OperationType.CREATE, 'transactions');
    } finally {
      setLoading(false);
    }
  };

  const openModal = (type: TransactionType, tx?: Transaction) => {
    setModalType(type);
    setSelectedCategory('ALL');
    if (tx) {
      setEditingTransaction(tx);
      const item = items.find(i => i.id === tx.itemId);
      setFormData({
        invoiceNo: tx.invoiceNo || '',
        sourceDestination: tx.sourceDestination || '',
        location: tx.location || '',
        salesPerson: tx.salesPerson || '',
        date: (type === 'OUT' && tx.type === 'SCHEDULED') 
          ? format(new Date(), "yyyy-MM-dd'T'HH:mm") 
          : format(new Date(tx.date), "yyyy-MM-dd'T'HH:mm"),
        items: [{ 
          categoryId: item?.categoryId || 'ALL',
          itemId: tx.itemId, 
          quantity: tx.quantity, 
          fromScheduled: type === 'OUT' && tx.type === 'SCHEDULED' ? true : (tx.fromScheduled || false),
          originalTxId: tx.id
        }]
      });
    } else {
      setEditingTransaction(null);
      setFormData({
        invoiceNo: '',
        sourceDestination: '',
        location: '',
        salesPerson: '',
        date: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        items: [{ categoryId: 'ALL', itemId: '', quantity: 1, fromScheduled: false, originalTxId: '' }]
      });
    }
    setIsModalOpen(true);
  };

  const openPIDispatchModal = (invoiceNo: string) => {
    const relatedTxs = transactions.filter(t => t.invoiceNo === invoiceNo && t.type === 'SCHEDULED');
    if (relatedTxs.length === 0) return;
    
    const firstTx = relatedTxs[0];
    setModalType('OUT');
    setEditingTransaction(null);
    setFormData({
      invoiceNo: firstTx.invoiceNo || '',
      sourceDestination: firstTx.sourceDestination || '',
      location: firstTx.location || '',
      salesPerson: firstTx.salesPerson || '',
      date: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      items: relatedTxs.map(t => {
        const item = items.find(i => i.id === t.itemId);
        return {
          categoryId: item?.categoryId || 'ALL',
          itemId: t.itemId,
          quantity: t.quantity,
          fromScheduled: true,
          originalTxId: t.id
        };
      })
    });
    setIsModalOpen(true);
  };

  const addItemRow = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { categoryId: 'ALL', itemId: '', quantity: 1, fromScheduled: false, originalTxId: '' }]
    }));
  };

  const removeItemRow = (index: number) => {
    if (formData.items.length === 1) return;
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  const updateItemRow = (index: number, field: string, value: any) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map((item, i) => i === index ? { ...item, [field]: value } : item)
    }));
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingTransaction(null);
  };

  const handleBatchUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTxIds.length === 0) return;
    if (!batchFormData.updateInvoice && !batchFormData.updateSourceDest && !batchFormData.updateLocation) {
      return toast.error('Please select at least one field to update');
    }

    setLoading(true);
    const toastId = toast.loading(`Updating ${selectedTxIds.length} transactions...`);
    try {
      const batch = writeBatch(db);
      const updates: any = {};
      if (batchFormData.updateInvoice) updates.invoiceNo = batchFormData.invoiceNo;
      if (batchFormData.updateSourceDest) updates.sourceDestination = batchFormData.sourceDestination;
      if (batchFormData.updateLocation) updates.location = batchFormData.location;

      selectedTxIds.forEach(id => {
        const docRef = doc(db, 'transactions', id);
        batch.update(docRef, updates);
      });

      await batch.commit();
      toast.success('Batch update successful', { id: toastId });
      setIsBatchModalOpen(false);
      setSelectedTxIds([]);
      setBatchFormData({
        invoiceNo: '',
        sourceDestination: '',
        location: '',
        updateInvoice: false,
        updateSourceDest: false,
        updateLocation: false
      });
    } catch (error) {
      toast.dismiss(toastId);
      handleFirestoreError(error, OperationType.UPDATE, 'transactions/batch');
    } finally {
      setLoading(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedTxIds.length === filteredTransactions.length) {
      setSelectedTxIds([]);
    } else {
      setSelectedTxIds(filteredTransactions.map(tx => tx.id));
    }
  };

  const toggleSelectTx = (id: string) => {
    setSelectedTxIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };
  
  const executeDelete = async () => {
    if (!confirmAction?.tx) return;
    const tx = confirmAction.tx;
    
    const toastId = toast.loading('Deleting transaction...');
    setLoading(true);
    try {
      await runTransaction(db, async (transaction) => {
        const itemRef = doc(db, 'items', tx.itemId);
        const itemSnap = await transaction.get(itemRef);
        
        if (!itemSnap.exists()) throw new Error("Item does not exist!");
        
        const currentStock = itemSnap.data().currentStock;
        const scheduledStock = itemSnap.data().scheduledStock || 0;
        
        let newStock = currentStock;
        let newScheduledStock = scheduledStock;

        if (tx.type === 'IN') {
          newStock = currentStock - tx.quantity;
        } else if (tx.type === 'OUT') {
          if (tx.fromScheduled) {
            newScheduledStock = scheduledStock + tx.quantity;
          } else {
            newStock = currentStock + tx.quantity;
          }
        } else if (tx.type === 'SCHEDULED') {
          newStock = currentStock + tx.quantity;
          newScheduledStock = scheduledStock - tx.quantity;
        }
        
        if (newStock < 0) throw new Error("Cannot delete this transaction as it would result in negative stock!");

        transaction.delete(doc(db, 'transactions', tx.id));
        transaction.update(itemRef, { 
          currentStock: newStock,
          scheduledStock: newScheduledStock
        });
      });
      toast.success('Transaction deleted successfully', { id: toastId });
    } catch (error) {
      toast.dismiss(toastId);
      handleFirestoreError(error, OperationType.DELETE, `transactions/${tx.id}`);
    } finally {
      setLoading(false);
      setConfirmAction(null);
    }
  };

  const filteredTransactions = transactions.filter(tx => {
    const item = items.find(i => i.id === tx.itemId);
    const matchesSearch = item?.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         tx.voucherNo.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'ALL' || tx.type === filterType;
    
    const txDate = new Date(tx.date).getTime();
    const matchesStart = !dateRange.start || txDate >= new Date(dateRange.start).getTime();
    const matchesEnd = !dateRange.end || txDate <= new Date(dateRange.end).setHours(23, 59, 59, 999);
    
    return matchesSearch && matchesType && matchesStart && matchesEnd;
  });

  const handleBatchDispatch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const scheduledTxs = filteredTransactions.filter(tx => selectedTxIds.includes(tx.id) && tx.type === 'SCHEDULED');
    if (scheduledTxs.length === 0) return toast.error('No scheduled transactions selected');

    setLoading(true);
    const toastId = toast.loading(`Dispatching ${scheduledTxs.length} items...`);
    try {
      await runTransaction(db, async (transaction) => {
        // 1. Reads
        const itemSnaps = new Map<string, any>();
        for (const tx of scheduledTxs) {
          if (!itemSnaps.has(tx.itemId)) {
            const itemRef = doc(db, 'items', tx.itemId);
            const itemSnap = await transaction.get(itemRef);
            if (!itemSnap.exists()) throw new Error(`Item ${tx.itemId} not found`);
            itemSnaps.set(tx.itemId, { ref: itemRef, data: itemSnap.data() });
          }
        }

        // 2. Writes
        for (const tx of scheduledTxs) {
          const itemInfo = itemSnaps.get(tx.itemId);
          const currentStock = itemInfo.data.currentStock;
          const scheduledStock = itemInfo.data.scheduledStock || 0;

          // Convert SCHEDULED -> OUT
          const newScheduledStock = scheduledStock - tx.quantity;
          if (newScheduledStock < 0) throw new Error(`Invalid scheduled stock for ${itemInfo.data.name}`);

          transaction.update(doc(db, 'transactions', tx.id), {
            type: 'OUT',
            fromScheduled: true,
            date: new Date(batchDispatchDate).toISOString()
          });

          transaction.update(itemInfo.ref, {
            scheduledStock: newScheduledStock
          });

          itemInfo.data.scheduledStock = newScheduledStock;
        }
      });
      toast.success('Batch dispatch successful', { id: toastId });
      setSelectedTxIds([]);
      setIsBatchDispatchModalOpen(false);
    } catch (error) {
      toast.dismiss(toastId);
      handleFirestoreError(error, OperationType.UPDATE, 'transactions/batch-dispatch');
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = () => {
    const data = filteredTransactions.map(tx => {
      const item = items.find(i => i.id === tx.itemId);
      const category = categories.find(c => c.id === item?.categoryId);
      const creator = users.find(u => u.uid === tx.createdBy);
      
      let createdByDisplay = 'System';
      if (creator) {
        createdByDisplay = `${creator.email.split('@')[0]} (${creator.role})`;
      } else if (tx.createdBy) {
        // Fallback for old transactions or if user data hasn't loaded
        createdByDisplay = tx.createdBy.substring(0, 8) + '...';
      }

      return {
        'Voucher No': tx.voucherNo,
        'Invoice/PI No': tx.invoiceNo || '-',
        'Date': format(new Date(tx.date), 'yyyy-MM-dd HH:mm'),
        'Type': tx.type,
        'Item Name': item?.name || 'Unknown',
        'Category': category?.name || 'Unknown',
        'Quantity': tx.quantity || 0,
        'Unit': item?.unit || '-',
        'Sales Person': tx.salesPerson || '-',
        'Created By': createdByDisplay,
        'Source/Destination': tx.sourceDestination || '-',
        'Location': tx.location || '-'
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");
    XLSX.writeFile(wb, `Inventory_Transactions_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success('Exported successfully');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Transaction History</h1>
          <p className="text-xs text-slate-500">Track all stock movements and vouchers</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button 
            onClick={() => openModal('IN')}
            className="flex items-center gap-2 bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20 text-sm"
          >
            <ArrowDownCircle size={18} />
            <span>Stock IN</span>
          </button>
          <button 
            onClick={() => openModal('OUT')}
            className="flex items-center gap-2 bg-rose-600 text-white px-3 py-1.5 rounded-lg hover:bg-rose-700 transition-colors shadow-lg shadow-rose-600/20 text-sm"
          >
            <ArrowUpCircle size={18} />
            <span>Stock OUT</span>
          </button>
          <button 
            onClick={() => openModal('SCHEDULED')}
            className="flex items-center gap-2 bg-amber-600 text-white px-3 py-1.5 rounded-lg hover:bg-amber-700 transition-colors shadow-lg shadow-amber-600/20 text-sm"
          >
            <Clock size={18} />
            <span>Scheduled</span>
          </button>
          {selectedTxIds.length > 0 && (
            <div className="flex gap-2">
              <button 
                onClick={() => setIsBatchModalOpen(true)}
                className="flex items-center gap-2 bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-600/20 animate-in zoom-in duration-200 text-sm"
              >
                <Edit2 size={18} />
                <span>Batch Edit ({selectedTxIds.length})</span>
              </button>
              {filteredTransactions.some(tx => selectedTxIds.includes(tx.id) && tx.type === 'SCHEDULED') && (
                <button 
                  onClick={() => {
                    setBatchDispatchDate(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
                    setIsBatchDispatchModalOpen(true);
                  }}
                  className="flex items-center gap-2 bg-emerald-600 text-white px-3 py-1.5 rounded-lg hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20 animate-in zoom-in duration-200 text-sm"
                >
                  <ArrowUpCircle size={18} />
                  <span>Batch Dispatch</span>
                </button>
              )}
            </div>
          )}
          <button 
            onClick={exportToExcel}
            className="flex items-center gap-2 bg-white border border-slate-200 px-3 py-1.5 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors shadow-sm text-sm"
          >
            <Download size={16} />
            <span>Export Excel</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input 
            type="text" 
            placeholder="Search by item or voucher..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <CalendarIcon size={16} className="text-slate-400" />
            <input 
              type="date"
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 outline-none"
            />
            <span className="text-slate-400 text-xs">to</span>
            <input 
              type="date"
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-slate-400" />
            <select 
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 outline-none text-sm"
            >
              <option value="ALL">All Types</option>
              <option value="IN">Stock IN</option>
              <option value="OUT">Stock OUT</option>
              <option value="SCHEDULED">Scheduled</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[10px] uppercase tracking-wider">
                <th className="px-4 py-3 font-semibold">
                  <input 
                    type="checkbox" 
                    checked={filteredTransactions.length > 0 && selectedTxIds.length === filteredTransactions.length}
                    onChange={toggleSelectAll}
                    className="w-3.5 h-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                  />
                </th>
                <th className="px-4 py-3 font-semibold">Voucher No</th>
                <th className="px-4 py-3 font-semibold">Invoice/PI</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Item</th>
                <th className="px-4 py-3 font-semibold">Quantity</th>
                <th className="px-4 py-3 font-semibold">Sales Person</th>
                <th className="px-4 py-3 font-semibold">Created By</th>
                <th className="px-4 py-3 font-semibold">Source/Dest</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTransactions.map((tx) => {
                const item = items.find(i => i.id === tx.itemId);
                const isSelected = selectedTxIds.includes(tx.id);
                return (
                  <tr key={tx.id} className={`hover:bg-slate-50 transition-colors ${isSelected ? 'bg-blue-50/50' : ''}`}>
                    <td className="px-4 py-3">
                      <input 
                        type="checkbox" 
                        checked={isSelected}
                        onChange={() => toggleSelectTx(tx.id)}
                        className="w-3.5 h-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-4 py-3 font-bold text-slate-900 text-sm">{tx.voucherNo}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 font-medium">{tx.invoiceNo || '-'}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {format(new Date(tx.date), 'MMM dd, yyyy HH:mm')}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        tx.type === 'IN' ? 'bg-emerald-100 text-emerald-800' : 
                        tx.type === 'OUT' ? 'bg-rose-100 text-rose-800' :
                        'bg-amber-100 text-amber-800'
                      }`}>
                        {tx.type === 'IN' ? <ArrowDownCircle size={10} /> : 
                         tx.type === 'OUT' ? <ArrowUpCircle size={10} /> :
                         <Clock size={10} />}
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-slate-900">{item?.name || 'Unknown'}</span>
                        <span className="text-[10px] text-slate-500">{categories.find(c => c.id === item?.categoryId)?.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1">
                          <span className="font-bold text-slate-900 text-sm">{tx.quantity}</span>
                          <span className="text-[10px] text-slate-500">{item?.unit}</span>
                        </div>
                        {tx.fromScheduled && (
                          <span className="text-[9px] font-bold text-amber-600 uppercase tracking-tight">From Scheduled</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium text-slate-600">{tx.salesPerson || '-'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-medium text-slate-600 truncate max-w-[100px]" title={users.find(u => u.uid === tx.createdBy)?.email || tx.createdBy}>
                          {users.find(u => u.uid === tx.createdBy)?.email?.split('@')[0] || 'Unknown'}
                        </span>
                        <span className="text-[9px] text-slate-400 uppercase tracking-wider font-bold">
                          {users.find(u => u.uid === tx.createdBy)?.role || 'staff'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 truncate max-w-[120px]">
                      {tx.sourceDestination || '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {tx.type === 'SCHEDULED' && (
                          <div className="flex gap-1">
                            <button 
                              onClick={() => {
                                openModal('OUT', tx);
                              }}
                              className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold bg-emerald-600 text-white hover:bg-emerald-700 rounded-lg transition-all shadow-sm shadow-emerald-600/20 active:scale-95"
                              title="Dispatch Scheduled Item"
                            >
                              <ArrowUpCircle size={12} />
                              <span>DISPATCH</span>
                            </button>
                            {tx.invoiceNo && transactions.filter(t => t.invoiceNo === tx.invoiceNo && t.type === 'SCHEDULED').length > 1 && (
                              <button 
                                onClick={() => openPIDispatchModal(tx.invoiceNo!)}
                                className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition-all shadow-sm shadow-indigo-600/20 active:scale-95"
                                title="Dispatch Entire PI"
                              >
                                <ArrowUpCircle size={12} />
                                <span>PI</span>
                              </button>
                            )}
                          </div>
                        )}
                        <button 
                          onClick={() => openModal(tx.type, tx)}
                          className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit Transaction"
                        >
                          <Edit2 size={16} />
                        </button>
                        <button 
                          onClick={() => setConfirmAction({ type: 'DELETE', tx })}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          title="Delete Transaction"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-slate-400 italic text-sm">
                    No transactions found matching your criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col">
            <div className={`p-6 border-b border-slate-100 flex items-center justify-between shrink-0 ${
              modalType === 'IN' ? 'bg-emerald-50' : 
              modalType === 'OUT' ? 'bg-rose-50' :
              'bg-amber-50'
            }`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${
                  modalType === 'IN' ? 'bg-emerald-600 text-white' : 
                  modalType === 'OUT' ? 'bg-rose-600 text-white' :
                  'bg-amber-600 text-white'
                }`}>
                  {modalType === 'IN' ? <ArrowDownCircle size={24} /> : 
                   modalType === 'OUT' ? <ArrowUpCircle size={24} /> :
                   <Clock size={24} />}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Material {modalType} {editingTransaction ? 'Edit' : 'Entry'}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">Voucher: {editingTransaction ? editingTransaction.voucherNo : generateVoucherNo()}</p>
                </div>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600">
                <X size={24} />
              </button>
            </div>
            
            <form 
              onSubmit={handleSubmit} 
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  const target = e.target as HTMLElement;
                  if (target.tagName !== 'SELECT' && target.tagName !== 'INPUT') {
                    handleSubmit(e);
                  }
                }
              }}
              className="flex-1 flex flex-col min-h-0"
            >
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2 grid grid-cols-1 md:grid-cols-3 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Invoice / PI No</label>
                    <input
                      type="text"
                      value={formData.invoiceNo}
                      onChange={(e) => setFormData({ ...formData, invoiceNo: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white"
                      placeholder="e.g. INV-2024-001"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Date & Time</label>
                    <div className="relative">
                      <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input
                        type="datetime-local"
                        required
                        value={formData.date}
                        onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                        className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Location</label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input
                        type="text"
                        value={formData.location}
                        onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                        className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white"
                        placeholder="e.g. Warehouse A"
                      />
                    </div>
                  </div>
                  <div className="md:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1">
                        {modalType === 'IN' ? 'Supplier / Source' : 
                         modalType === 'OUT' ? 'Destination / Usage' :
                         'Scheduled For / Destination'}
                      </label>
                      <input
                        type="text"
                        value={formData.sourceDestination}
                        onChange={(e) => setFormData({ ...formData, sourceDestination: e.target.value })}
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white"
                        placeholder={modalType === 'IN' ? 'e.g. ABC Suppliers' : 
                                     modalType === 'OUT' ? 'e.g. Production Line A' :
                                     'e.g. Customer Name / Order #'}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1">Sales Person</label>
                      <div className="relative">
                        <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                          type="text"
                          value={formData.salesPerson}
                          onChange={(e) => setFormData({ ...formData, salesPerson: e.target.value })}
                          className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white"
                          placeholder="Name of sales person"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-2 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Items List</h4>
                    {!editingTransaction && (
                      <button 
                        type="button"
                        onClick={addItemRow}
                        className="text-blue-600 hover:text-blue-700 text-sm font-bold flex items-center gap-1"
                      >
                        <Plus size={16} />
                        Add Another Item
                      </button>
                    )}
                  </div>

                  <div className="space-y-4">
                    {formData.items.map((item, index) => (
                      <div key={index} className="p-4 border border-slate-100 rounded-xl bg-white shadow-sm space-y-4 relative">
                        {formData.items.length > 1 && (
                          <button 
                            type="button"
                            onClick={() => removeItemRow(index)}
                            className="absolute top-2 right-2 text-slate-400 hover:text-rose-600"
                          >
                            <X size={18} />
                          </button>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Category</label>
                            <select
                              value={item.categoryId}
                              disabled={!!editingTransaction}
                              onChange={(e) => {
                                updateItemRow(index, 'categoryId', e.target.value);
                                updateItemRow(index, 'itemId', ''); // Reset item when category changes
                              }}
                              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white disabled:bg-slate-50"
                            >
                              <option value="ALL">All Categories</option>
                              {categories.map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Select Item</label>
                            <div className="relative">
                              <Package className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                              <select
                                required
                                disabled={!!editingTransaction}
                                value={item.itemId}
                                onChange={(e) => updateItemRow(index, 'itemId', e.target.value)}
                                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all appearance-none bg-white disabled:bg-slate-50"
                              >
                                <option value="">Choose an item...</option>
                                {items
                                  .filter(i => item.categoryId === 'ALL' || i.categoryId === item.categoryId)
                                  .map(i => (
                                    <option key={i.id} value={i.id}>
                                      {i.name} (Avail: {i.currentStock}, Sch: {i.scheduledStock || 0} {i.unit})
                                    </option>
                                  ))}
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Quantity</label>
                            <input
                              type="number"
                              required
                              min="1"
                              value={item.quantity || ''}
                              onChange={(e) => updateItemRow(index, 'quantity', parseInt(e.target.value) || 0)}
                              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                            />
                          </div>
                          {modalType === 'OUT' && (
                            <div className="flex items-end pb-2">
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={item.fromScheduled}
                                  onChange={(e) => updateItemRow(index, 'fromScheduled', e.target.checked)}
                                  className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                                />
                                <span className="text-xs font-medium text-slate-600">From Scheduled Stock</span>
                              </label>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-row-reverse gap-3 p-6 border-t border-slate-100 bg-slate-50 shrink-0">
                <button
                  type="submit"
                  disabled={loading}
                  className={`flex-1 text-white font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${
                    modalType === 'IN' ? 'bg-emerald-600 hover:bg-emerald-700' : 
                    modalType === 'OUT' ? 'bg-rose-600 hover:bg-rose-700' :
                    'bg-amber-600 hover:bg-amber-700'
                  }`}
                >
                  {loading ? (
                    <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <Plus size={18} />
                      {editingTransaction ? 'Update' : 'Confirm'} {modalType}
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-6 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertTriangle size={32} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">
                Delete Transaction
              </h3>
              <p className="text-slate-500 mb-6">
                Are you sure you want to delete transaction {confirmAction.tx?.voucherNo}? This will adjust the item stock accordingly.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmAction(null)}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 font-semibold rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={executeDelete}
                  disabled={loading}
                  className="flex-1 bg-rose-600 text-white font-semibold py-2 rounded-lg hover:bg-rose-700 transition-colors disabled:opacity-50"
                >
                  {loading ? 'Processing...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Edit Modal */}
      {isBatchModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 bg-indigo-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-600 text-white rounded-lg">
                  <Edit2 size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Batch Edit Transactions</h3>
                  <p className="text-xs text-slate-500 font-medium">Updating {selectedTxIds.length} selected items</p>
                </div>
              </div>
              <button onClick={() => setIsBatchModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleBatchUpdate} className="p-6 space-y-6">
              <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
                Select the fields you want to update for all {selectedTxIds.length} selected transactions. This is useful for grouping multiple items under the same invoice.
              </p>

              <div className="space-y-4">
                <div className="p-4 border border-slate-100 rounded-xl space-y-3">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id="updateInvoice"
                      checked={batchFormData.updateInvoice}
                      onChange={(e) => setBatchFormData({ ...batchFormData, updateInvoice: e.target.checked })}
                      className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                    />
                    <label htmlFor="updateInvoice" className="text-sm font-bold text-slate-700 cursor-pointer">Update Invoice / PI No</label>
                  </div>
                  {batchFormData.updateInvoice && (
                    <input
                      type="text"
                      value={batchFormData.invoiceNo}
                      onChange={(e) => setBatchFormData({ ...batchFormData, invoiceNo: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                      placeholder="e.g. INV-2024-001"
                      required
                    />
                  )}
                </div>

                <div className="p-4 border border-slate-100 rounded-xl space-y-3">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id="updateSourceDest"
                      checked={batchFormData.updateSourceDest}
                      onChange={(e) => setBatchFormData({ ...batchFormData, updateSourceDest: e.target.checked })}
                      className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                    />
                    <label htmlFor="updateSourceDest" className="text-sm font-bold text-slate-700 cursor-pointer">Update Source / Destination</label>
                  </div>
                  {batchFormData.updateSourceDest && (
                    <input
                      type="text"
                      value={batchFormData.sourceDestination}
                      onChange={(e) => setBatchFormData({ ...batchFormData, sourceDestination: e.target.value })}
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                      placeholder="e.g. Production Line A"
                      required
                    />
                  )}
                </div>

                <div className="p-4 border border-slate-100 rounded-xl space-y-3">
                  <div className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id="updateLocation"
                      checked={batchFormData.updateLocation}
                      onChange={(e) => setBatchFormData({ ...batchFormData, updateLocation: e.target.checked })}
                      className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                    />
                    <label htmlFor="updateLocation" className="text-sm font-bold text-slate-700 cursor-pointer">Update Location</label>
                  </div>
                  {batchFormData.updateLocation && (
                    <div className="relative">
                      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                      <input
                        type="text"
                        value={batchFormData.location}
                        onChange={(e) => setBatchFormData({ ...batchFormData, location: e.target.value })}
                        className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                        placeholder="e.g. Warehouse A, Shelf 4"
                        required
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-row-reverse gap-3 pt-4">
                <button
                  type="submit"
                  disabled={loading || (!batchFormData.updateInvoice && !batchFormData.updateSourceDest && !batchFormData.updateLocation)}
                  className="flex-1 bg-indigo-600 text-white font-semibold py-2 rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading ? (
                    <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <Edit2 size={18} />
                      Apply Batch Update
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setIsBatchModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 font-semibold rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Batch Dispatch Modal */}
      {isBatchDispatchModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 bg-emerald-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-600 text-white">
                  <ArrowUpCircle size={24} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Batch Dispatch</h3>
                  <p className="text-xs text-slate-500 font-medium">Convert selected scheduled items to Stock OUT</p>
                </div>
              </div>
              <button onClick={() => setIsBatchDispatchModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleBatchDispatch} className="p-6 space-y-6">
              <div className="space-y-4">
                <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl flex items-start gap-3">
                  <AlertTriangle className="text-amber-600 shrink-0" size={20} />
                  <p className="text-sm text-amber-800 leading-relaxed">
                    You are about to dispatch <strong>{selectedTxIds.length}</strong> items. This will reduce current stock and clear scheduled stock for each item.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Dispatch Date & Time</label>
                  <div className="relative">
                    <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      type="datetime-local"
                      required
                      value={batchDispatchDate}
                      onChange={(e) => setBatchDispatchDate(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                    />
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-500 italic">
                    Default is current time. Adjust if the material left earlier.
                  </p>
                </div>
              </div>

              <div className="flex flex-row-reverse gap-3 pt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-emerald-600 text-white font-semibold py-2 rounded-lg hover:bg-emerald-700 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {loading ? (
                    <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <ArrowUpCircle size={18} />
                      Confirm Batch Dispatch
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setIsBatchDispatchModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 font-semibold rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
