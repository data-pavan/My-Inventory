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
import Select from 'react-select';
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
  Edit2,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import { useAuth } from '../App';
import { motion } from 'motion/react';

export default function Transactions() {
  const { profile } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [modalType, setModalType] = useState<TransactionType>('IN');
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInvoice, setSearchInvoice] = useState('');
  const [searchSalesPerson, setSearchSalesPerson] = useState('');
  const [searchSourceDest, setSearchSourceDest] = useState('');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [dateRange, setDateRange] = useState({
    start: '',
    end: ''
  });

  const [confirmAction, setConfirmAction] = useState<{
    type: 'DELETE' | 'BULK_DELETE' | 'PI_DELETE';
    tx?: Transaction;
    invoiceNo?: string;
    txIds?: string[];
  } | null>(null);

  const [pin, setPin] = useState('');
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const DELETE_PIN = '202603';

  const [formData, setFormData] = useState({
    invoiceNo: '',
    sourceDestination: '',
    location: '',
    salesPerson: '',
    totalBoxes: 0,
    date: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    items: [{ categoryId: 'ALL', itemId: '', quantity: 1, fromScheduled: false, originalTxId: '', production: 0, rejected: 0 }]
  });

  const [factoryInData, setFactoryInData] = useState({
    shift: 'Day Shift',
    date: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
    items: [{ categoryId: '', itemId: '', production: 0, rejected: 0 }]
  });

  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedTxIds, setSelectedTxIds] = useState<string[]>([]);
  const [isBatchModalOpen, setIsBatchModalOpen] = useState(false);
  const [isBatchDispatchModalOpen, setIsBatchDispatchModalOpen] = useState(false);
  const [isFactoryInModalOpen, setIsFactoryInModalOpen] = useState(false);
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

    let unsubUsers = () => {};
    if (profile?.role === 'admin') {
      unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
        setUsers(snap.docs.map(doc => doc.data() as UserProfile));
      });
    }

    return () => {
      unsubTx();
      unsubItems();
      unsubCats();
      unsubUsers();
    };
  }, [profile]);

  const generateVoucherNo = (type?: TransactionType) => {
    const t = type || modalType;
    const prefix = t === 'IN' ? 'VIN' : t === 'OUT' ? 'VOUT' : t === 'SCHEDULED' ? 'VSCH' : 'VFIN';
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
              totalBoxes: formData.totalBoxes,
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
              totalBoxes: formData.totalBoxes,
              voucherNo,
              type: modalType,
              createdBy: auth.currentUser?.uid,
              creatorEmail: profile?.email || auth.currentUser?.email || 'Unknown',
              creatorRole: profile?.role || 'staff',
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

  const handleFactoryInSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (factoryInData.items.some(item => !item.itemId)) {
      return toast.error('Please select an item for all rows');
    }
    
    setLoading(true);
    try {
      await runTransaction(db, async (transaction) => {
        for (const item of factoryInData.items) {
          const totalGood = Math.max(0, item.production - item.rejected);
          const itemRef = doc(db, 'items', item.itemId);
          const itemSnap = await transaction.get(itemRef);
          
          if (!itemSnap.exists()) throw new Error(`Item ${item.itemId} not found`);
          
          const itemData = itemSnap.data() as Item;
          const newStock = (itemData.currentStock || 0) + totalGood;
          
          const voucherNo = generateVoucherNo('FACTORY_IN');
          const txData = {
            itemId: item.itemId,
            quantity: totalGood,
            production: item.production,
            rejected: item.rejected,
            shift: factoryInData.shift,
            voucherNo,
            type: 'FACTORY_IN',
            createdBy: auth.currentUser?.uid,
            creatorEmail: profile?.email || auth.currentUser?.email || 'Unknown',
            creatorRole: profile?.role || 'staff',
            date: new Date(factoryInData.date).toISOString(),
          };

          transaction.set(doc(collection(db, 'transactions')), txData);
          transaction.update(itemRef, { currentStock: newStock });
        }
      });

      toast.success('Factory production recorded successfully');
      setIsFactoryInModalOpen(false);
      setFactoryInData({
        shift: 'Day Shift',
        date: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        items: [{ categoryId: '', itemId: '', production: 0, rejected: 0 }]
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'transactions/factory-in');
    } finally {
      setLoading(false);
    }
  };

  const addFactoryInItem = () => {
    const allowedCategories = categories.filter(cat => 
      ['PP Tiles', 'Soft Tiles', 'Kerbs Male', 'Kerbs Female', 'Corner'].includes(cat.name)
    );
    const firstCatId = allowedCategories.length > 0 ? allowedCategories[0].id : '';
    
    setFactoryInData({
      ...factoryInData,
      items: [...factoryInData.items, { categoryId: firstCatId, itemId: '', production: 0, rejected: 0 }]
    });
  };

  const removeFactoryInItem = (index: number) => {
    if (factoryInData.items.length <= 1) return;
    const newItems = [...factoryInData.items];
    newItems.splice(index, 1);
    setFactoryInData({ ...factoryInData, items: newItems });
  };

  const updateFactoryInItem = (index: number, field: string, value: any) => {
    const newItems = [...factoryInData.items];
    newItems[index] = { ...newItems[index], [field]: value };
    if (field === 'categoryId') {
      newItems[index].itemId = '';
    }
    setFactoryInData({ ...factoryInData, items: newItems });
  };

  const openFactoryInModal = () => {
    const allowedCategories = categories.filter(cat => 
      ['PP Tiles', 'Soft Tiles', 'Kerbs Male', 'Kerbs Female', 'Corner'].includes(cat.name)
    );
    const firstCatId = allowedCategories.length > 0 ? allowedCategories[0].id : '';
    
    setFactoryInData({
      shift: 'Day Shift',
      date: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      items: [{ categoryId: firstCatId, itemId: '', production: 0, rejected: 0 }]
    });
    setIsFactoryInModalOpen(true);
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
        totalBoxes: tx.totalBoxes || 0,
        date: (type === 'OUT' && tx.type === 'SCHEDULED') 
          ? format(new Date(), "yyyy-MM-dd'T'HH:mm") 
          : format(new Date(tx.date), "yyyy-MM-dd'T'HH:mm"),
        items: [{ 
          categoryId: item?.categoryId || 'ALL',
          itemId: tx.itemId, 
          quantity: tx.quantity, 
          fromScheduled: type === 'OUT' && tx.type === 'SCHEDULED' ? true : (tx.fromScheduled || false),
          originalTxId: tx.id,
          production: tx.production || 0,
          rejected: tx.rejected || 0
        }]
      });
    } else {
      setEditingTransaction(null);
      setFormData({
        invoiceNo: '',
        sourceDestination: '',
        location: '',
        salesPerson: '',
        totalBoxes: 0,
        date: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
        items: [{ categoryId: 'ALL', itemId: '', quantity: 1, fromScheduled: false, originalTxId: '', production: 0, rejected: 0 }]
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
      totalBoxes: firstTx.totalBoxes || 0,
      date: format(new Date(), "yyyy-MM-dd'T'HH:mm"),
      items: relatedTxs.map(t => {
        const item = items.find(i => i.id === t.itemId);
        return {
          categoryId: item?.categoryId || 'ALL',
          itemId: t.itemId,
          quantity: t.quantity,
          fromScheduled: true,
          originalTxId: t.id,
          production: 0,
          rejected: 0
        };
      })
    });
    setIsModalOpen(true);
  };

  const addItemRow = () => {
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, { categoryId: 'ALL', itemId: '', quantity: 1, fromScheduled: false, originalTxId: '', production: 0, rejected: 0 }]
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
    if (!confirmAction) return;
    if (pin !== DELETE_PIN) return toast.error('Invalid PIN');
    
    const toastId = toast.loading('Processing deletion...');
    setLoading(true);
    try {
      await runTransaction(db, async (transaction) => {
        let txsToDelete: Transaction[] = [];
        
        if (confirmAction.type === 'DELETE' && confirmAction.tx) {
          txsToDelete = [confirmAction.tx];
        } else if (confirmAction.type === 'BULK_DELETE' && confirmAction.txIds) {
          txsToDelete = transactions.filter(t => confirmAction.txIds?.includes(t.id));
        } else if (confirmAction.type === 'PI_DELETE' && confirmAction.invoiceNo) {
          txsToDelete = transactions.filter(t => t.invoiceNo === confirmAction.invoiceNo);
        }

        if (txsToDelete.length === 0) throw new Error("No transactions found to delete");

        // Group by itemId to minimize reads
        const itemIds = Array.from(new Set(txsToDelete.map(t => t.itemId)));
        const itemSnaps = new Map<string, any>();
        
        for (const id of itemIds) {
          const itemRef = doc(db, 'items', id);
          const itemSnap = await transaction.get(itemRef);
          if (!itemSnap.exists()) throw new Error(`Item ${id} does not exist!`);
          itemSnaps.set(id, { ref: itemRef, data: itemSnap.data() });
        }

        for (const tx of txsToDelete) {
          const itemInfo = itemSnaps.get(tx.itemId);
          let currentStock = itemInfo.data.currentStock;
          let scheduledStock = itemInfo.data.scheduledStock || 0;
          
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
          
          if (newStock < 0) throw new Error(`Cannot delete transaction ${tx.voucherNo} as it would result in negative stock for ${itemInfo.data.name}!`);

          transaction.delete(doc(db, 'transactions', tx.id));
          transaction.update(itemInfo.ref, { 
            currentStock: newStock,
            scheduledStock: newScheduledStock
          });

          // Update local map for subsequent txs of same item
          itemInfo.data.currentStock = newStock;
          itemInfo.data.scheduledStock = newScheduledStock;
        }
      });
      toast.success('Deletion successful', { id: toastId });
      setSelectedTxIds([]);
    } catch (error) {
      toast.dismiss(toastId);
      handleFirestoreError(error, OperationType.DELETE, 'transactions/delete');
    } finally {
      setLoading(false);
      setConfirmAction(null);
      setPin('');
      setIsPinModalOpen(false);
    }
  };

  const initiateDelete = (type: 'DELETE' | 'BULK_DELETE' | 'PI_DELETE', data: any) => {
    setConfirmAction({
      type,
      ...data
    });
    setIsPinModalOpen(true);
  };

  const filteredTransactions = transactions.filter(tx => {
    const item = items.find(i => i.id === tx.itemId);
    const matchesSearch = item?.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         tx.voucherNo.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesInvoice = !searchInvoice || (tx.invoiceNo || '').toLowerCase().includes(searchInvoice.toLowerCase());
    const matchesSalesPerson = !searchSalesPerson || (tx.salesPerson || '').toLowerCase().includes(searchSalesPerson.toLowerCase());
    const matchesSourceDest = !searchSourceDest || (tx.sourceDestination || '').toLowerCase().includes(searchSourceDest.toLowerCase());
    
    const matchesType = filterType === 'ALL' || tx.type === filterType;
    
    const txDate = new Date(tx.date).getTime();
    const matchesStart = !dateRange.start || txDate >= new Date(dateRange.start).getTime();
    const matchesEnd = !dateRange.end || txDate <= new Date(dateRange.end).setHours(23, 59, 59, 999);
    
    return matchesSearch && matchesInvoice && matchesSalesPerson && matchesSourceDest && matchesType && matchesStart && matchesEnd;
  });

  const [expandedVouchers, setExpandedVouchers] = useState<string[]>([]);

  const toggleVoucher = (voucherNo: string) => {
    setExpandedVouchers(prev => 
      prev.includes(voucherNo) ? prev.filter(v => v !== voucherNo) : [...prev, voucherNo]
    );
  };

  const groupedTransactions = React.useMemo(() => {
    const groups: { [key: string]: Transaction[] } = {};
    filteredTransactions.forEach(tx => {
      if (!groups[tx.voucherNo]) {
        groups[tx.voucherNo] = [];
      }
      groups[tx.voucherNo].push(tx);
    });
    return Object.values(groups).sort((a, b) => 
      new Date(b[0].date).getTime() - new Date(a[0].date).getTime()
    );
  }, [filteredTransactions]);

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
    const sortedTransactions = [...filteredTransactions].sort((a, b) => {
      const itemA = items.find(i => i.id === a.itemId);
      const itemB = items.find(i => i.id === b.itemId);
      const catA = categories.find(c => c.id === itemA?.categoryId)?.name || '';
      const catB = categories.find(c => c.id === itemB?.categoryId)?.name || '';
      if (catA === catB) {
        return (itemA?.name || '').localeCompare(itemB?.name || '');
      }
      return catA.localeCompare(catB);
    });

    const data = sortedTransactions.map(tx => {
      const item = items.find(i => i.id === tx.itemId);
      const category = categories.find(c => c.id === item?.categoryId);
      
      let createdByDisplay = tx.creatorEmail 
        ? `${tx.creatorEmail.split('@')[0]} (${tx.creatorRole || 'staff'})`
        : (tx.createdBy ? tx.createdBy.substring(0, 8) + '...' : 'System');

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
        'Location': tx.location || '-',
        'Total Boxes': tx.totalBoxes || 0
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");
    XLSX.writeFile(wb, `Inventory_Transactions_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success('Exported successfully');
  };

  return (
    <div className="space-y-4 pb-24 md:pb-8">
      {/* Header Section */}
      <div className="flex flex-col gap-4 px-1 sm:px-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-900 tracking-tight">Transactions</h1>
            <p className="text-[11px] md:text-sm text-slate-500 font-medium">Manage your stock movements</p>
          </div>
          <div className="hidden sm:flex items-center gap-2">
            <button 
              onClick={exportToExcel}
              className="flex items-center gap-2 bg-white border border-slate-200 px-3 py-2 rounded-xl text-slate-700 hover:bg-slate-50 transition-all shadow-sm text-sm font-bold"
            >
              <Download size={18} />
              <span>Export</span>
            </button>
          </div>
        </div>

        {/* Action Buttons - Mobile Optimized */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 relative z-10">
          <button 
            type="button"
            onClick={() => openModal('IN')}
            className="flex flex-col items-center justify-center gap-1.5 bg-emerald-600 text-white p-3 rounded-2xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 active:scale-95"
          >
            <ArrowDownCircle size={20} />
            <span className="text-[10px] font-bold uppercase tracking-wider">Stock IN</span>
          </button>
          <button 
            type="button"
            onClick={() => openModal('OUT')}
            className="flex flex-col items-center justify-center gap-1.5 bg-rose-600 text-white p-3 rounded-2xl hover:bg-rose-700 transition-all shadow-lg shadow-rose-600/20 active:scale-95"
          >
            <ArrowUpCircle size={20} />
            <span className="text-[10px] font-bold uppercase tracking-wider">Stock OUT</span>
          </button>
          <button 
            type="button"
            onClick={() => openModal('SCHEDULED')}
            className="flex flex-col items-center justify-center gap-1.5 bg-amber-600 text-white p-3 rounded-2xl hover:bg-amber-700 transition-all shadow-lg shadow-amber-600/20 active:scale-95"
          >
            <Clock size={20} />
            <span className="text-[10px] font-bold uppercase tracking-wider">Scheduled</span>
          </button>
          <button 
            type="button"
            onClick={openFactoryInModal}
            className="flex flex-col items-center justify-center gap-1.5 bg-indigo-600 text-white p-3 rounded-2xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-600/20 active:scale-95"
          >
            <Plus size={20} />
            <span className="text-[10px] font-bold uppercase tracking-wider">Factory In</span>
          </button>
        </div>
      </div>

      {/* Selection Toolbar */}
      {selectedTxIds.length > 0 && (
        <div className="sticky top-4 z-30 bg-indigo-600 text-white p-3 rounded-2xl shadow-xl flex items-center gap-3 animate-in slide-in-from-top-4 duration-300 mx-1 sm:mx-0">
          <div className="bg-white/20 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest">
            {selectedTxIds.length} Selected
          </div>
          <div className="flex gap-1.5 flex-1 overflow-x-auto no-scrollbar">
            <button 
              onClick={() => setIsBatchModalOpen(true)}
              className="shrink-0 flex items-center gap-1.5 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-xl transition-colors text-[10px] font-bold uppercase"
            >
              <Edit2 size={14} />
              <span>Edit</span>
            </button>
            {filteredTransactions.some(tx => selectedTxIds.includes(tx.id) && tx.type === 'SCHEDULED') && (
              <button 
                onClick={() => {
                  setBatchDispatchDate(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
                  setIsBatchDispatchModalOpen(true);
                }}
                className="shrink-0 flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-600 px-3 py-1.5 rounded-xl transition-colors text-[10px] font-bold uppercase"
              >
                <ArrowUpCircle size={14} />
                <span>Dispatch</span>
              </button>
            )}
            <button 
              onClick={() => initiateDelete('BULK_DELETE', { txIds: selectedTxIds })}
              className="shrink-0 flex items-center gap-1.5 bg-rose-500 hover:bg-rose-600 px-3 py-1.5 rounded-xl transition-colors text-[10px] font-bold uppercase"
            >
              <Trash2 size={14} />
              <span>Delete</span>
            </button>
          </div>
          <button 
            onClick={() => setSelectedTxIds([])}
            className="p-1 hover:bg-white/10 rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>
      )}

      {/* Search & Filters Section */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-4 mx-1 sm:mx-0">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-7 relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors" size={18} />
            <input 
              type="text" 
              placeholder="Search items or voucher..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-2xl focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:bg-white focus:border-blue-500 transition-all text-sm font-medium"
            />
          </div>
          
          <div className="md:col-span-5 flex gap-2">
            <div className="flex-1 flex items-center gap-2 bg-slate-50 border border-slate-100 rounded-2xl px-4 py-3">
              <Filter size={18} className="text-slate-400" />
              <select 
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="bg-transparent border-none p-0 focus:ring-0 w-full text-sm font-bold text-slate-700 outline-none appearance-none"
              >
                <option value="ALL">All Movements</option>
                <option value="IN">Stock IN</option>
                <option value="OUT">Stock OUT</option>
                <option value="SCHEDULED">Scheduled</option>
              </select>
            </div>
            <button 
              onClick={exportToExcel}
              className="sm:hidden flex items-center justify-center w-12 bg-slate-50 border border-slate-100 rounded-2xl text-slate-600 active:scale-95 transition-all"
            >
              <Download size={20} />
            </button>
          </div>
        </div>

        {/* Advanced Filters Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400 uppercase tracking-widest">PI</div>
            <input 
              type="text" 
              placeholder="Invoice No..." 
              value={searchInvoice}
              onChange={(e) => setSearchInvoice(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50/50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-xs font-bold"
            />
          </div>
          <div className="relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400 uppercase tracking-widest">By</div>
            <input 
              type="text" 
              placeholder="Sales Person..." 
              value={searchSalesPerson}
              onChange={(e) => setSearchSalesPerson(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50/50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-xs font-bold"
            />
          </div>
          <div className="relative">
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400 uppercase tracking-widest">To</div>
            <input 
              type="text" 
              placeholder="Source/Dest..." 
              value={searchSourceDest}
              onChange={(e) => setSearchSourceDest(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50/50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all text-xs font-bold"
            />
          </div>
          <div className="flex items-center gap-2 bg-slate-50/50 border border-slate-100 rounded-xl px-3 py-2">
            <CalendarIcon size={14} className="text-slate-400 shrink-0" />
            <div className="flex items-center gap-1 w-full">
              <input 
                type="date"
                value={dateRange.start}
                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                className="bg-transparent border-none p-0 text-[10px] font-bold focus:ring-0 w-full outline-none"
              />
              <span className="text-slate-300">-</span>
              <input 
                type="date"
                value={dateRange.end}
                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                className="bg-transparent border-none p-0 text-[10px] font-bold focus:ring-0 w-full outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Mobile View - Grouped Cards */}
      <div className="md:hidden space-y-4 px-1">
        {groupedTransactions.length === 0 ? (
          <div className="bg-white p-12 rounded-2xl border-2 border-dashed border-slate-100 text-center">
            <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Search className="text-slate-300" size={32} />
            </div>
            <p className="text-slate-600 font-bold">No results found</p>
            <p className="text-slate-400 text-xs mt-1">Try adjusting your search or filters</p>
          </div>
        ) : (
          groupedTransactions.map((group) => {
            const firstTx = group[0];
            const voucherNo = firstTx.voucherNo;
            const isExpanded = expandedVouchers.includes(voucherNo);
            const allSelected = group.every(tx => selectedTxIds.includes(tx.id));
            const someSelected = group.some(tx => selectedTxIds.includes(tx.id));
            
            return (
              <div 
                key={voucherNo} 
                className={`bg-white rounded-2xl border-2 transition-all overflow-hidden ${
                  allSelected ? 'border-indigo-500 shadow-lg shadow-indigo-500/10' : 
                  someSelected ? 'border-indigo-300 shadow-sm' : 'border-slate-50 shadow-sm'
                }`}
              >
                {/* Card Header - Click to Expand */}
                <div 
                  className="cursor-pointer active:bg-slate-50 transition-colors flex flex-col"
                  onClick={() => toggleVoucher(voucherNo)}
                >
                  <div className="flex min-h-[100px]">
                    {/* Left Side - 30% Details Area */}
                    <div className="w-[30%] bg-slate-50/80 p-3 border-r border-slate-100 flex flex-col justify-between">
                      <div className="space-y-2">
                        <div>
                          <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-0.5">PI / Invoice</p>
                          <p className="text-[10px] font-black text-slate-900 truncate">{firstTx.invoiceNo || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Sales Person</p>
                          <p className="text-[10px] font-bold text-slate-600 truncate">{firstTx.salesPerson || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Destination</p>
                          <p className="text-[10px] font-bold text-slate-600 truncate">{firstTx.sourceDestination || 'N/A'}</p>
                        </div>
                      </div>
                      
                      {group.some(t => t.type === 'SCHEDULED') && (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            openPIDispatchModal(voucherNo);
                          }}
                          className="mt-2 bg-emerald-600 text-white py-1 px-2 rounded-lg text-[8px] font-black uppercase tracking-widest shadow-sm shadow-emerald-600/20 active:scale-95 transition-all"
                        >
                          Dispatch PI
                        </button>
                      )}
                    </div>

                    {/* Right Side - 70% Main Info */}
                    <div className="w-[70%] p-3 flex flex-col justify-between">
                      <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            firstTx.type === 'IN' ? 'bg-emerald-100 text-emerald-600' : 
                            firstTx.type === 'OUT' ? 'bg-rose-100 text-rose-600' : 
                            firstTx.type === 'FACTORY_IN' ? 'bg-indigo-100 text-indigo-600' :
                            'bg-amber-100 text-amber-600'
                          }`}>
                            {firstTx.type === 'IN' ? <ArrowDownCircle size={18} /> : 
                             firstTx.type === 'OUT' ? <ArrowUpCircle size={18} /> : 
                             firstTx.type === 'FACTORY_IN' ? <Plus size={18} /> :
                             <Clock size={18} />}
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-black text-slate-900 text-[11px] uppercase tracking-tight truncate">
                              {firstTx.type.replace('_', ' ')} Entry
                            </h3>
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{voucherNo}</p>
                          </div>
                        </div>
                        <div className="text-slate-400 shrink-0">
                          {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                        </div>
                      </div>

                      <div className="mt-2 flex items-end justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-1">
                            <MapPin size={10} className="text-slate-400 shrink-0" />
                            <p className="text-[10px] font-bold text-slate-500 truncate max-w-[120px]">
                              {firstTx.sourceDestination || firstTx.location || 'No Location'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold text-slate-400">{format(new Date(firstTx.date), 'MMM d, HH:mm')}</span>
                            <span className="w-1 h-1 rounded-full bg-slate-200"></span>
                            <span className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">{group.length} {group.length === 1 ? 'Item' : 'Items'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded Items List */}
                {isExpanded && (
                  <div className="border-t border-slate-50 bg-slate-50/30 animate-in slide-in-from-top-2 duration-200">
                    {/* Full Details Section */}
                    <div className="p-4 bg-white border-b border-slate-100 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                      <div>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Source/Destination</p>
                        <p className="text-[10px] font-bold text-slate-700">{firstTx.sourceDestination || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Location</p>
                        <p className="text-[10px] font-bold text-slate-700">{firstTx.location || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Invoice/PI No</p>
                        <p className="text-[10px] font-bold text-slate-700">{firstTx.invoiceNo || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Sales Person</p>
                        <p className="text-[10px] font-bold text-slate-700">{firstTx.salesPerson || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Total Boxes</p>
                        <p className="text-[10px] font-bold text-slate-700">{firstTx.totalBoxes || 0}</p>
                      </div>
                      <div className="sm:col-span-2 lg:col-span-1">
                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Creator</p>
                        <p className="text-[10px] font-bold text-slate-700 truncate">{firstTx.creatorEmail}</p>
                      </div>
                    </div>

                    <div className="p-2 space-y-2">
                      {group.map((tx) => {
                        const item = items.find(i => i.id === tx.itemId);
                        const isTxSelected = selectedTxIds.includes(tx.id);
                        return (
                          <div 
                            key={tx.id}
                            className={`flex items-center justify-between p-3 rounded-2xl border transition-all ${
                              isTxSelected ? 'bg-indigo-50 border-indigo-100' : 'bg-white border-slate-100'
                            }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelectTx(tx.id);
                            }}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`w-2 h-2 rounded-full ${
                                tx.type === 'IN' ? 'bg-emerald-500' : 
                                tx.type === 'OUT' ? 'bg-rose-500' : 
                                'bg-amber-500'
                              }`} />
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-800 truncate">{item?.name || 'Unknown Item'}</p>
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                                  {categories.find(c => c.id === item?.categoryId)?.name || 'General'}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <p className="text-sm font-black text-slate-900">{tx.quantity}</p>
                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter">{item?.unit}</p>
                              </div>
                              <div className="flex items-center gap-1">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openModal(tx.type, tx);
                                  }}
                                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    initiateDelete('DELETE', { tx });
                                  }}
                                  className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    
                    {/* Batch Actions for this Voucher */}
                    <div className="p-3 bg-slate-100/50 flex justify-between items-center">
                      <button 
                        onClick={() => {
                          const allIds = group.map(t => t.id);
                          const areAllSelected = allIds.every(id => selectedTxIds.includes(id));
                          if (areAllSelected) {
                            setSelectedTxIds(prev => prev.filter(id => !allIds.includes(id)));
                          } else {
                            setSelectedTxIds(prev => Array.from(new Set([...prev, ...allIds])));
                          }
                        }}
                        className="text-[10px] font-black uppercase tracking-widest text-indigo-600"
                      >
                        {allSelected ? 'Deselect All' : 'Select All Items'}
                      </button>
                      {firstTx.invoiceNo && (
                        <button 
                          onClick={() => initiateDelete('PI_DELETE', { invoiceNo: firstTx.invoiceNo })}
                          className="text-[10px] font-black uppercase tracking-widest text-rose-600 flex items-center gap-1"
                        >
                          <Trash2 size={12} />
                          Delete PI
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Desktop View - Grouped Table */}
      <div className="hidden md:block space-y-4">
        {groupedTransactions.length === 0 ? (
          <div className="bg-white p-12 rounded-2xl border-2 border-dashed border-slate-100 text-center">
            <div className="bg-slate-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Search className="text-slate-300" size={32} />
            </div>
            <p className="text-slate-600 font-bold">No results found</p>
          </div>
        ) : (
          groupedTransactions.map((group) => {
            const firstTx = group[0];
            const voucherNo = firstTx.voucherNo;
            const isExpanded = expandedVouchers.includes(voucherNo);
            const allSelected = group.every(tx => selectedTxIds.includes(tx.id));
            const someSelected = group.some(tx => selectedTxIds.includes(tx.id));

            return (
              <div 
                key={voucherNo}
                className={`bg-white rounded-2xl border transition-all overflow-hidden ${
                  allSelected ? 'border-indigo-500 shadow-md' : 
                  someSelected ? 'border-indigo-200' : 'border-slate-100 shadow-sm'
                }`}
              >
                {/* Group Header */}
                <div 
                  className="p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => toggleVoucher(voucherNo)}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      firstTx.type === 'IN' ? 'bg-emerald-50 text-emerald-600' : 
                      firstTx.type === 'OUT' ? 'bg-rose-50 text-rose-600' : 
                      firstTx.type === 'FACTORY_IN' ? 'bg-indigo-50 text-indigo-600' :
                      'bg-amber-50 text-amber-600'
                    }`}>
                      {firstTx.type === 'IN' ? <ArrowDownCircle size={22} /> : 
                       firstTx.type === 'OUT' ? <ArrowUpCircle size={22} /> : 
                       firstTx.type === 'FACTORY_IN' ? <Plus size={22} /> :
                       <Clock size={22} />}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-black text-slate-900 text-sm uppercase tracking-tight">
                          {firstTx.type.replace('_', ' ')} Entry
                        </h3>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{voucherNo}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-bold text-slate-500">{format(new Date(firstTx.date), 'MMM d, yyyy HH:mm')}</span>
                        <span className="w-1 h-1 rounded-full bg-slate-200"></span>
                        <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">{group.length} {group.length === 1 ? 'Item' : 'Items'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    {group.some(t => t.type === 'SCHEDULED') && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          openPIDispatchModal(voucherNo);
                        }}
                        className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-600/20 hover:bg-emerald-700 active:scale-95 transition-all flex items-center gap-2"
                      >
                        <ArrowUpCircle size={14} />
                        Dispatch PI
                      </button>
                    )}
                    <div className="flex items-center gap-6 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
                      <div className="flex flex-col">
                        <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-0.5">PI / Invoice</p>
                        <span className="text-[10px] font-black text-slate-900 uppercase tracking-tight">
                          {firstTx.invoiceNo || 'N/A'}
                        </span>
                      </div>
                      <div className="w-px h-6 bg-slate-200" />
                      <div className="flex flex-col">
                        <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Sales Person</p>
                        <span className="text-[10px] font-bold text-slate-600 flex items-center gap-1">
                          <UserIcon size={12} className="text-slate-400" /> {firstTx.salesPerson || 'N/A'}
                        </span>
                      </div>
                      <div className="w-px h-6 bg-slate-200" />
                      <div className="flex flex-col">
                        <p className="text-[7px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Destination</p>
                        <span className="text-[10px] font-bold text-slate-600 flex items-center gap-1">
                          <MapPin size={12} className="text-slate-400" /> {firstTx.sourceDestination || 'N/A'}
                        </span>
                      </div>
                    </div>
                    <div className="text-slate-400">
                      {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                    </div>
                  </div>
                </div>

                {/* Group Content */}
                {isExpanded && (
                  <div className="border-t border-slate-50 bg-slate-50/30">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="bg-slate-100/50 text-slate-500 text-[9px] uppercase tracking-wider">
                            <th className="px-6 py-2 font-black">
                              <input 
                                type="checkbox" 
                                checked={allSelected}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  const allIds = group.map(t => t.id);
                                  if (allSelected) {
                                    setSelectedTxIds(prev => prev.filter(id => !allIds.includes(id)));
                                  } else {
                                    setSelectedTxIds(prev => Array.from(new Set([...prev, ...allIds])));
                                  }
                                }}
                                className="w-3.5 h-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                              />
                            </th>
                            <th className="px-4 py-2 font-black">Item Name</th>
                            <th className="px-4 py-2 font-black">Category</th>
                            <th className="px-4 py-2 font-black">Quantity</th>
                            <th className="px-4 py-2 font-black">Unit</th>
                            {firstTx.type === 'FACTORY_IN' && (
                              <>
                                <th className="px-4 py-2 font-black">Production</th>
                                <th className="px-4 py-2 font-black">Rejected</th>
                              </>
                            )}
                            <th className="px-4 py-2 font-black text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {group.map((tx) => {
                            const item = items.find(i => i.id === tx.itemId);
                            const isSelected = selectedTxIds.includes(tx.id);
                            return (
                              <tr key={tx.id} className={`hover:bg-white transition-colors ${isSelected ? 'bg-indigo-50/50' : ''}`}>
                                <td className="px-6 py-3">
                                  <input 
                                    type="checkbox" 
                                    checked={isSelected}
                                    onChange={() => toggleSelectTx(tx.id)}
                                    className="w-3.5 h-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                                  />
                                </td>
                                <td className="px-4 py-3 text-xs font-bold text-slate-900">{item?.name || 'Unknown'}</td>
                                <td className="px-4 py-3 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                                  {categories.find(c => c.id === item?.categoryId)?.name || 'General'}
                                </td>
                                <td className="px-4 py-3 text-xs font-black text-slate-900">{tx.quantity}</td>
                                <td className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-widest">{item?.unit}</td>
                                {tx.type === 'FACTORY_IN' && (
                                  <>
                                    <td className="px-4 py-3 text-xs font-bold text-emerald-600">{tx.production || 0}</td>
                                    <td className="px-4 py-3 text-xs font-bold text-rose-600">{tx.rejected || 0}</td>
                                  </>
                                )}
                                <td className="px-4 py-3 text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <button 
                                      onClick={() => openModal(tx.type, tx)}
                                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                    >
                                      <Edit2 size={14} />
                                    </button>
                                    <button 
                                      onClick={() => initiateDelete('DELETE', { tx })}
                                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Factory In Modal */}
      {isFactoryInModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-[2rem] shadow-2xl w-full max-w-4xl overflow-hidden border border-slate-100 max-h-[90vh] flex flex-col"
          >
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-indigo-50/30 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-600/20">
                  <Plus size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Factory Production</h2>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Record shift-wise production</p>
                </div>
              </div>
              <button 
                onClick={() => setIsFactoryInModalOpen(false)}
                className="p-2 hover:bg-white rounded-xl transition-colors text-slate-400 hover:text-slate-600"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleFactoryInSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Shift and Date Selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 bg-slate-50 p-5 rounded-3xl border border-slate-100">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Select Shift</label>
                  <div className="flex gap-2">
                    {['Day Shift', 'Night Shift'].map(shift => (
                      <button
                        key={shift}
                        type="button"
                        onClick={() => setFactoryInData({ ...factoryInData, shift })}
                        className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all border-2 ${
                          factoryInData.shift === shift 
                            ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-600/20' 
                            : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-200'
                        }`}
                      >
                        {shift}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Production Date & Time</label>
                  <input
                    type="datetime-local"
                    value={factoryInData.date}
                    onChange={(e) => setFactoryInData({ ...factoryInData, date: e.target.value })}
                    className="w-full bg-white border-2 border-slate-200 rounded-2xl px-4 py-3 text-sm font-bold focus:border-indigo-500 focus:ring-0 transition-all outline-none"
                    required
                  />
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Production Items</h3>
                  <button
                    type="button"
                    onClick={addFactoryInItem}
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-100 transition-all"
                  >
                    <Plus size={14} />
                    Add Item
                  </button>
                </div>

                <div className="space-y-3">
                  {factoryInData.items.map((item, index) => (
                    <div 
                      key={index}
                      className="group bg-white border-2 border-slate-100 rounded-3xl p-5 hover:border-indigo-100 transition-all relative"
                    >
                      {factoryInData.items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeFactoryInItem(index)}
                          className="absolute -top-2 -right-2 w-8 h-8 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all shadow-sm border border-rose-100 opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}

                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                        <div className="lg:col-span-3 space-y-1.5">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Category</label>
                          <select
                            value={item.categoryId}
                            onChange={(e) => updateFactoryInItem(index, 'categoryId', e.target.value)}
                            className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold focus:border-indigo-500 focus:ring-0 transition-all outline-none"
                            required
                          >
                            <option value="">Category</option>
                            {categories
                              .filter(cat => ['PP Tiles', 'Soft Tiles', 'Kerbs Male', 'Kerbs Female', 'Corner'].includes(cat.name))
                              .map(cat => (
                                <option key={cat.id} value={cat.id}>{cat.name}</option>
                              ))
                            }
                          </select>
                        </div>

                        <div className="lg:col-span-3 space-y-1.5">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Item</label>
                          <Select
                            isDisabled={!item.categoryId}
                            value={items
                              .filter(i => i.categoryId === item.categoryId)
                              .find(i => i.id === item.itemId) 
                              ? { 
                                  value: item.itemId, 
                                  label: items.find(i => i.id === item.itemId)?.name 
                                } 
                              : null
                            }
                            onChange={(option) => updateFactoryInItem(index, 'itemId', option ? option.value : '')}
                            options={items
                              .filter(i => i.categoryId === item.categoryId)
                              .map(i => ({ value: i.id, label: i.name }))
                            }
                            placeholder="Select Item"
                            className="react-select-container"
                            classNamePrefix="react-select"
                            styles={{
                              control: (base) => ({
                                ...base,
                                backgroundColor: '#f8fafc',
                                border: '2px solid #f1f5f9',
                                borderRadius: '1rem',
                                padding: '0.25rem 0.5rem',
                                fontSize: '0.875rem',
                                fontWeight: '700',
                                boxShadow: 'none',
                                '&:hover': {
                                  borderColor: '#f1f5f9'
                                }
                              }),
                              menu: (base) => ({
                                ...base,
                                borderRadius: '1rem',
                                overflow: 'hidden',
                                zIndex: 50
                              }),
                              option: (base, state) => ({
                                ...base,
                                backgroundColor: state.isSelected ? '#4f46e5' : state.isFocused ? '#f1f5f9' : 'white',
                                color: state.isSelected ? 'white' : '#1e293b',
                                fontWeight: '700',
                                fontSize: '0.875rem'
                              })
                            }}
                          />
                        </div>

                        <div className="lg:col-span-2 space-y-1.5">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Production</label>
                          <input
                            type="number"
                            value={item.production}
                            onChange={(e) => updateFactoryInItem(index, 'production', e.target.value === '' ? 0 : Number(e.target.value))}
                            className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold focus:border-indigo-500 focus:ring-0 transition-all outline-none"
                            placeholder="0"
                            min="0"
                            required
                          />
                        </div>

                        <div className="lg:col-span-2 space-y-1.5">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Rejected</label>
                          <input
                            type="number"
                            value={item.rejected}
                            onChange={(e) => updateFactoryInItem(index, 'rejected', e.target.value === '' ? 0 : Number(e.target.value))}
                            className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-4 py-3 text-sm font-bold focus:border-indigo-500 focus:ring-0 transition-all outline-none"
                            placeholder="0"
                            min="0"
                            required
                          />
                        </div>

                        <div className="lg:col-span-2 flex flex-col justify-end pb-1">
                          <div className="bg-indigo-50 px-4 py-2.5 rounded-2xl border border-indigo-100">
                            <p className="text-[8px] font-black text-indigo-400 uppercase tracking-widest leading-none mb-1">Good Parts</p>
                            <p className="text-lg font-black text-indigo-600 leading-none">
                              {Math.max(0, item.production - item.rejected)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="shrink-0 flex gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsFactoryInModalOpen(false)}
                  className="flex-1 px-6 py-4 rounded-2xl text-sm font-black text-slate-500 bg-slate-100 hover:bg-slate-200 transition-all uppercase tracking-widest"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-[2] px-6 py-4 rounded-2xl text-sm font-black text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-600/20 uppercase tracking-widest flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <>
                      <Plus size={18} />
                      <span>Record Production</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-2xl max-h-[95vh] sm:max-h-[90vh] overflow-hidden animate-in slide-in-from-bottom sm:zoom-in duration-300 flex flex-col">
            <div className={`p-4 sm:p-6 border-b border-slate-100 flex items-center justify-between shrink-0 ${
              modalType === 'IN' ? 'bg-emerald-50' : 
              modalType === 'OUT' ? 'bg-rose-50' :
              'bg-amber-50'
            }`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-xl ${
                  modalType === 'IN' ? 'bg-emerald-600 text-white' : 
                  modalType === 'OUT' ? 'bg-rose-600 text-white' :
                  'bg-amber-600 text-white'
                }`}>
                  {modalType === 'IN' ? <ArrowDownCircle size={24} /> : 
                   modalType === 'OUT' ? <ArrowUpCircle size={24} /> :
                   <Clock size={24} />}
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-slate-900 uppercase tracking-tight">
                    {modalType} {editingTransaction ? 'Edit' : 'Entry'}
                  </h3>
                  <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Voucher: {editingTransaction ? editingTransaction.voucherNo : generateVoucherNo()}</p>
                </div>
              </div>
              <button onClick={closeModal} className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors">
                <X size={24} />
              </button>
            </div>
            
            <form 
              onSubmit={handleSubmit} 
              className="flex-1 flex flex-col min-h-0"
            >
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
                {/* Header Info Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                  <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Invoice / PI No</label>
                      <input
                        type="text"
                        value={formData.invoiceNo}
                        onChange={(e) => setFormData({ ...formData, invoiceNo: e.target.value })}
                        className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all text-sm font-bold"
                        placeholder="INV-001"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Date & Time</label>
                      <div className="relative">
                        <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                          type="datetime-local"
                          required
                          value={formData.date}
                          onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all text-sm font-bold"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Location</label>
                      <div className="relative">
                        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                          type="text"
                          value={formData.location}
                          onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all text-sm font-bold"
                          placeholder="Warehouse"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Total Boxes</label>
                      <div className="relative">
                        <Package className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                          type="number"
                          value={formData.totalBoxes}
                          onChange={(e) => setFormData({ ...formData, totalBoxes: e.target.value === '' ? 0 : Number(e.target.value) })}
                          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all text-sm font-bold"
                          placeholder="0"
                        />
                      </div>
                    </div>
                  </div>
                  
                  <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
                        {modalType === 'IN' ? 'Supplier / Source' : 
                         modalType === 'OUT' ? 'Destination / Usage' :
                         'Scheduled For'}
                      </label>
                      <input
                        type="text"
                        value={formData.sourceDestination}
                        onChange={(e) => setFormData({ ...formData, sourceDestination: e.target.value })}
                        className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all text-sm font-bold"
                        placeholder="Entity Name"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Sales Person</label>
                      <div className="relative">
                        <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                          type="text"
                          value={formData.salesPerson}
                          onChange={(e) => setFormData({ ...formData, salesPerson: e.target.value })}
                          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all text-sm font-bold"
                          placeholder="Name"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Items List */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between px-1">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Items to {modalType}</h4>
                    {!editingTransaction && (
                      <button 
                        type="button"
                        onClick={addItemRow}
                        className="text-blue-600 hover:text-blue-700 text-[10px] font-black uppercase tracking-widest flex items-center gap-1 bg-blue-50 px-3 py-1.5 rounded-xl transition-all active:scale-95"
                      >
                        <Plus size={14} />
                        Add Item
                      </button>
                    )}
                  </div>

                  <div className="space-y-3">
                    {formData.items.map((item, index) => (
                      <div key={index} className="p-4 border-2 border-slate-50 rounded-2xl bg-white shadow-sm space-y-4 relative animate-in slide-in-from-right-4 duration-300">
                        {formData.items.length > 1 && (
                          <button 
                            type="button"
                            onClick={() => removeItemRow(index)}
                            className="absolute -top-2 -right-2 w-8 h-8 bg-white border-2 border-slate-50 text-slate-400 hover:text-rose-600 rounded-full flex items-center justify-center shadow-sm transition-colors"
                          >
                            <X size={16} />
                          </button>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Category</label>
                              <select
                                value={item.categoryId}
                                disabled={!!editingTransaction}
                                onChange={(e) => {
                                  updateItemRow(index, 'categoryId', e.target.value);
                                  updateItemRow(index, 'itemId', '');
                                }}
                                className="w-full px-4 py-2.5 bg-slate-50/50 border border-slate-100 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all text-xs font-bold disabled:opacity-50 appearance-none"
                              >
                                <option value="ALL">All Categories</option>
                                {categories.map(cat => (
                                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Select Item</label>
                              <div className="relative">
                                <Select
                                  isDisabled={!!editingTransaction}
                                  value={items
                                    .filter(i => item.categoryId === 'ALL' || i.categoryId === item.categoryId)
                                    .find(i => i.id === item.itemId) 
                                    ? { 
                                        value: item.itemId, 
                                        label: items.find(i => i.id === item.itemId)?.name 
                                      } 
                                    : null
                                  }
                                  onChange={(option) => updateItemRow(index, 'itemId', option ? option.value : '')}
                                  options={items
                                    .filter(i => item.categoryId === 'ALL' || i.categoryId === item.categoryId)
                                    .map(i => ({ value: i.id, label: `${i.name} (${i.currentStock} ${i.unit})` }))
                                  }
                                  placeholder="Choose item..."
                                  className="react-select-container"
                                  classNamePrefix="react-select"
                                  styles={{
                                    control: (base) => ({
                                      ...base,
                                      backgroundColor: '#f8fafc',
                                      border: '1px solid #f1f5f9',
                                      borderRadius: '0.75rem',
                                      padding: '0.125rem 0.25rem',
                                      fontSize: '0.75rem',
                                      fontWeight: '700',
                                      boxShadow: 'none',
                                      '&:hover': {
                                        borderColor: '#f1f5f9'
                                      }
                                    }),
                                    menu: (base) => ({
                                      ...base,
                                      borderRadius: '0.75rem',
                                      overflow: 'hidden',
                                      zIndex: 50
                                    }),
                                    option: (base, state) => ({
                                      ...base,
                                      backgroundColor: state.isSelected ? '#3b82f6' : state.isFocused ? '#f1f5f9' : 'white',
                                      color: state.isSelected ? 'white' : '#1e293b',
                                      fontWeight: '700',
                                      fontSize: '0.75rem'
                                    })
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-4">
                            <div className="flex-1">
                              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Quantity</label>
                              <input
                                type="number"
                                required
                                min="1"
                                value={item.quantity}
                                onChange={(e) => updateItemRow(index, 'quantity', e.target.value === '' ? 0 : Number(e.target.value))}
                                className="w-full px-4 py-2.5 bg-slate-50/50 border border-slate-100 rounded-xl focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all text-sm font-bold"
                              />
                            </div>
                            {modalType === 'OUT' && (
                              <div className="pt-5">
                                <label className="flex items-center gap-2 cursor-pointer group">
                                  <div className={`w-10 h-6 rounded-full transition-all relative ${item.fromScheduled ? 'bg-blue-500' : 'bg-slate-200'}`}>
                                    <input
                                      type="checkbox"
                                      checked={item.fromScheduled}
                                      onChange={(e) => updateItemRow(index, 'fromScheduled', e.target.checked)}
                                      className="sr-only"
                                    />
                                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${item.fromScheduled ? 'left-5' : 'left-1'}`}></div>
                                  </div>
                                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-slate-600 transition-colors">Sch</span>
                                </label>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-4 sm:p-6 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row-reverse gap-3 shrink-0">
                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full sm:flex-1 text-white font-black uppercase tracking-widest py-4 sm:py-3 rounded-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] shadow-lg ${
                    modalType === 'IN' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20' : 
                    modalType === 'OUT' ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/20' :
                    'bg-amber-600 hover:bg-amber-700 shadow-amber-600/20'
                  }`}
                >
                  {loading ? (
                    <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <>
                      {editingTransaction ? <Edit2 size={18} /> : <Plus size={18} />}
                      <span>{editingTransaction ? 'Update' : 'Confirm'} {modalType}</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  className="w-full sm:w-auto px-8 py-4 sm:py-3 border-2 border-slate-200 text-slate-500 font-black uppercase tracking-widest rounded-2xl hover:bg-slate-100 transition-all active:scale-[0.98]"
                >
                  Cancel
                </button>
              </div>
            </form>
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
      {/* PIN Verification Modal */}
      {isPinModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-rose-50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-rose-100 text-rose-600 rounded-lg">
                  <AlertTriangle size={20} />
                </div>
                <h3 className="text-lg font-bold text-slate-900">Confirm Deletion</h3>
              </div>
              <button onClick={() => setIsPinModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600">
                {confirmAction?.type === 'BULK_DELETE' ? `Are you sure you want to delete ${confirmAction.txIds?.length} selected transactions?` :
                 confirmAction?.type === 'PI_DELETE' ? `Are you sure you want to delete all transactions for PI: ${confirmAction.invoiceNo}?` :
                 'Are you sure you want to delete this transaction?'}
                <br />
                <span className="font-bold text-rose-600">This action cannot be undone and stock will be adjusted.</span>
              </p>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Enter PIN to Confirm</label>
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-rose-500 outline-none text-center text-xl tracking-[1em] font-bold"
                  placeholder="••••••"
                  maxLength={6}
                  autoFocus
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setIsPinModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 font-semibold rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={executeDelete}
                  disabled={loading || pin.length < 6}
                  className="flex-1 bg-rose-600 text-white font-semibold py-2 rounded-lg hover:bg-rose-700 transition-colors disabled:opacity-50"
                >
                  {loading ? 'Processing...' : 'Delete Now'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
