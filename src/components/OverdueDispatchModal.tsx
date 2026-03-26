import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, runTransaction, writeBatch, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Transaction, Item, OperationType } from '../types';
import { format, isBefore, isSameDay, startOfDay } from 'date-fns';
import { AlertTriangle, Calendar, X, Clock, Trash2, CheckCircle2, Package, MapPin } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { handleFirestoreError } from '../utils/error-handler';

export default function OverdueDispatchModal() {
  const [overdueTransactions, setOverdueTransactions] = useState<Transaction[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hasShown, setHasShown] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState<string>(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);

  useEffect(() => {
    // Fetch items for stock updates
    const unsubItems = onSnapshot(collection(db, 'items'), (snap) => {
      setItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item)));
    });

    // Fetch scheduled transactions
    const q = query(collection(db, 'transactions'), where('type', '==', 'SCHEDULED'));
    const unsubTx = onSnapshot(q, (snap) => {
      const allScheduled = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      const today = startOfDay(new Date());
      
      const overdue = allScheduled.filter(tx => {
        const txDate = new Date(tx.date);
        return isBefore(txDate, today) || isSameDay(txDate, today);
      });

      setOverdueTransactions(overdue);

      // Show modal if there are overdue items and we haven't shown it this session
      if (overdue.length > 0 && !hasShown) {
        setIsOpen(true);
        setHasShown(true);
      }
    });

    return () => {
      unsubItems();
      unsubTx();
    };
  }, [hasShown]);

  const handleCancel = async (tx: Transaction) => {
    if (!window.confirm('Are you sure you want to cancel this scheduled dispatch? Stock will be restored.')) return;
    
    setLoading(tx.id);
    try {
      await runTransaction(db, async (transaction) => {
        const itemRef = doc(db, 'items', tx.itemId);
        const itemSnap = await transaction.get(itemRef);
        
        if (!itemSnap.exists()) throw new Error('Item not found');
        
        const itemData = itemSnap.data() as Item;
        const newStock = (itemData.currentStock || 0) + tx.quantity;
        const newScheduled = (itemData.scheduledStock || 0) - tx.quantity;

        transaction.delete(doc(db, 'transactions', tx.id));
        transaction.update(itemRef, {
          currentStock: newStock,
          scheduledStock: Math.max(0, newScheduled)
        });
      });
      toast.success('Dispatch cancelled and stock restored');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'transactions');
    } finally {
      setLoading(null);
    }
  };

  const handleReschedule = async (tx: Transaction) => {
    if (!rescheduleDate) return toast.error('Please select a new date');
    
    setLoading(tx.id);
    try {
      await updateDoc(doc(db, 'transactions', tx.id), {
        date: new Date(rescheduleDate).toISOString()
      });
      toast.success('Dispatch rescheduled');
      setReschedulingId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'transactions');
    } finally {
      setLoading(null);
    }
  };

  if (!isOpen || overdueTransactions.length === 0) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]">
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-amber-50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 text-amber-600 rounded-lg">
              <AlertTriangle size={24} />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">Today's & Overdue Dispatches</h3>
              <p className="text-xs text-slate-500">You have {overdueTransactions.length} pending dispatches that need attention.</p>
            </div>
          </div>
          <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {overdueTransactions.map((tx) => {
            const item = items.find(i => i.id === tx.itemId);
            const isRescheduling = reschedulingId === tx.id;
            
            return (
              <div key={tx.id} className="bg-slate-50 border border-slate-200 rounded-xl p-3 hover:border-amber-200 transition-colors">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded uppercase tracking-wider">
                        {tx.voucherNo}
                      </span>
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Clock size={12} />
                        {format(new Date(tx.date), 'MMM dd, yyyy HH:mm')}
                      </span>
                    </div>
                    <h4 className="font-bold text-slate-900 text-sm">{item?.name || 'Unknown Item'}</h4>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-600">
                      <div className="flex items-center gap-1">
                        <Package size={14} className="text-slate-400" />
                        <span className="font-semibold">{tx.quantity} {item?.unit}</span>
                      </div>
                      {tx.sourceDestination && (
                        <div className="flex items-center gap-1">
                          <MapPin size={14} className="text-slate-400" />
                          <span>{tx.sourceDestination}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {!isRescheduling ? (
                      <>
                        <button
                          onClick={() => {
                            setReschedulingId(tx.id);
                            setRescheduleDate(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-xs font-semibold transition-colors"
                        >
                          <Calendar size={14} />
                          Reschedule
                        </button>
                        <button
                          onClick={() => handleCancel(tx)}
                          disabled={loading === tx.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-rose-200 text-rose-600 rounded-lg hover:bg-rose-50 text-xs font-semibold transition-colors disabled:opacity-50"
                        >
                          {loading === tx.id ? (
                            <div className="h-3 w-3 border-2 border-rose-600 border-t-transparent rounded-full animate-spin"></div>
                          ) : (
                            <Trash2 size={14} />
                          )}
                          Cancel
                        </button>
                      </>
                    ) : (
                      <div className="flex items-center gap-2 animate-in slide-in-from-right-2 duration-200">
                        <input
                          type="datetime-local"
                          value={rescheduleDate}
                          onChange={(e) => setRescheduleDate(e.target.value)}
                          className="px-2 py-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={() => handleReschedule(tx)}
                          disabled={loading === tx.id}
                          className="p-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                        >
                          <CheckCircle2 size={16} />
                        </button>
                        <button
                          onClick={() => setReschedulingId(null)}
                          className="p-1.5 bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300 transition-colors"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
          <button
            onClick={() => setIsOpen(false)}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 text-sm font-bold transition-colors"
          >
            Review Later
          </button>
        </div>
      </div>
    </div>
  );
}
