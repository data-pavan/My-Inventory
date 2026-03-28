import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, runTransaction, writeBatch, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Transaction, Item, OperationType } from '../types';
import { format, isBefore, isSameDay, startOfDay, addDays, addHours } from 'date-fns';
import { AlertTriangle, Calendar, X, Clock, Trash2, CheckCircle2, Package, MapPin, User, ChevronRight } from 'lucide-react';
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
  const [reschedulingGroup, setReschedulingGroup] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<{ [key: string]: boolean }>({});

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups(prev => ({
      ...prev,
      [groupKey]: !prev[groupKey]
    }));
  };

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

  const handleReschedulePI = async (txs: Transaction[], customDate?: Date) => {
    const targetDate = customDate || new Date(rescheduleDate);
    if (!targetDate) return toast.error('Please select a new date');

    setLoading('GROUP_' + (txs[0].invoiceNo || txs[0].voucherNo));
    try {
      const batch = writeBatch(db);
      txs.forEach(tx => {
        batch.update(doc(db, 'transactions', tx.id), {
          date: targetDate.toISOString()
        });
      });
      await batch.commit();
      toast.success('PI rescheduled successfully');
      setReschedulingGroup(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'transactions');
    } finally {
      setLoading(null);
    }
  };

  const groupedOverdue = React.useMemo(() => {
    const groups: { [key: string]: Transaction[] } = {};
    overdueTransactions.forEach(tx => {
      const key = tx.invoiceNo || tx.voucherNo;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(tx);
    });
    return Object.entries(groups).sort((a, b) => 
      new Date(b[1][0].date).getTime() - new Date(a[1][0].date).getTime()
    );
  }, [overdueTransactions]);

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
              <p className="text-xs text-slate-500">You have {overdueTransactions.length} pending dispatches across {groupedOverdue.length} groups.</p>
            </div>
          </div>
          <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-8">
          {groupedOverdue.map(([groupKey, groupTxs]) => {
            const firstTx = groupTxs[0];
            const isGroupRescheduling = reschedulingGroup === groupKey;
            
            return (
              <div key={groupKey} className="bg-white rounded-2xl border-2 border-slate-50 overflow-hidden shadow-sm">
                {/* Group Header - Full Details */}
                <div 
                  onClick={() => toggleGroup(groupKey)}
                  className="flex min-h-[100px] border-b border-slate-50 cursor-pointer hover:bg-slate-50/50 transition-colors group/header"
                >
                  {/* Left Side - 30% Details Area (Matching Transactions History) */}
                  <div className="w-[30%] bg-amber-50/50 p-3 border-r border-slate-100 flex flex-col justify-between">
                    <div className="space-y-2">
                      <div>
                        <p className="text-[7px] font-black text-amber-600/60 uppercase tracking-widest mb-0.5">PI / Invoice</p>
                        <p className="text-[10px] font-black text-slate-900 truncate">{firstTx.invoiceNo || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-[7px] font-black text-amber-600/60 uppercase tracking-widest mb-0.5">Sales Person</p>
                        <p className="text-[10px] font-bold text-slate-600 truncate">{firstTx.salesPerson || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="text-[7px] font-black text-amber-600/60 uppercase tracking-widest mb-0.5">Destination</p>
                        <p className="text-[10px] font-bold text-slate-600 truncate">{firstTx.sourceDestination || 'N/A'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Right Side - Group Actions */}
                  <div className="w-[70%] p-3 flex flex-col justify-between relative">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                          <Clock size={18} />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-black text-slate-900 text-[11px] uppercase tracking-tight truncate">
                            Pending Dispatch
                          </h3>
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{groupKey}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="bg-amber-100 text-amber-700 px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest">
                          {groupTxs.length} Items
                        </div>
                        <ChevronRight 
                          size={18} 
                          className={`text-slate-400 transition-transform duration-200 ${expandedGroups[groupKey] ? 'rotate-90' : ''}`} 
                        />
                      </div>
                    </div>

                    <div onClick={(e) => e.stopPropagation()}>
                      {!isGroupRescheduling ? (
                        <div className="mt-3 flex gap-2">
                          <button 
                            onClick={() => {
                              setReschedulingGroup(groupKey);
                              setRescheduleDate(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
                            }}
                            className="flex-1 bg-amber-600 text-white py-1.5 rounded-xl text-[9px] font-black uppercase tracking-widest shadow-sm shadow-amber-600/20 active:scale-95 transition-all flex items-center justify-center gap-1.5"
                          >
                            <Calendar size={12} />
                            Reschedule PI
                          </button>
                        </div>
                      ) : (
                        <div className="mt-3 space-y-2 animate-in slide-in-from-top-2 duration-200">
                          <div className="flex items-center gap-2">
                            <input
                              type="datetime-local"
                              value={rescheduleDate}
                              onChange={(e) => setRescheduleDate(e.target.value)}
                              className="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-[10px] font-bold outline-none focus:ring-2 focus:ring-amber-500"
                            />
                            <button
                              onClick={() => handleReschedulePI(groupTxs)}
                              disabled={loading === 'GROUP_' + groupKey}
                              className="p-1.5 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
                            >
                              <CheckCircle2 size={16} />
                            </button>
                            <button
                              onClick={() => setReschedulingGroup(null)}
                              className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                            >
                              <X size={16} />
                            </button>
                          </div>
                          {/* Quick Options */}
                          <div className="flex gap-1.5">
                            <button 
                              onClick={() => handleReschedulePI(groupTxs, addDays(new Date(), 1))}
                              className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-600 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest border border-slate-200 transition-all"
                            >
                              Tomorrow
                            </button>
                            <button 
                              onClick={() => handleReschedulePI(groupTxs, addDays(new Date(), 2))}
                              className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-600 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest border border-slate-200 transition-all"
                            >
                              2 Days Later
                            </button>
                            <button 
                              onClick={() => handleReschedulePI(groupTxs, addDays(new Date(), 3))}
                              className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-600 py-1 rounded-lg text-[8px] font-black uppercase tracking-widest border border-slate-200 transition-all"
                            >
                              3 Days Later
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Items List */}
                {expandedGroups[groupKey] && (
                  <div className="bg-slate-50/30 p-3 space-y-2 animate-in slide-in-from-top-2 duration-200">
                    {groupTxs.map((tx) => {
                      const item = items.find(i => i.id === tx.itemId);
                      const isRescheduling = reschedulingId === tx.id;
                      
                      return (
                        <div key={tx.id} className="bg-white border border-slate-100 rounded-xl p-2.5 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center shrink-0 border border-slate-100">
                              <Package size={16} className="text-slate-400" />
                            </div>
                            <div className="min-w-0">
                              <h4 className="font-bold text-slate-900 text-[11px] truncate">{item?.name || 'Unknown Item'}</h4>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[9px] font-black text-indigo-600 uppercase tracking-widest">{tx.quantity} {item?.unit}</span>
                                <span className="w-1 h-1 rounded-full bg-slate-200"></span>
                                <span className="text-[9px] font-bold text-slate-400 flex items-center gap-1">
                                  <Clock size={10} />
                                  {format(new Date(tx.date), 'MMM dd')}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            {!isRescheduling ? (
                              <>
                                <button
                                  onClick={() => {
                                    setReschedulingId(tx.id);
                                    setRescheduleDate(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-all"
                                  title="Reschedule Item"
                                >
                                  <Calendar size={14} />
                                </button>
                                <button
                                  onClick={() => handleCancel(tx)}
                                  disabled={loading === tx.id}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                                  title="Cancel Item"
                                >
                                  {loading === tx.id ? (
                                    <div className="h-3.5 w-3.5 border-2 border-rose-600 border-t-transparent rounded-full animate-spin"></div>
                                  ) : (
                                    <Trash2 size={14} />
                                  )}
                                </button>
                              </>
                            ) : (
                              <div className="flex items-center gap-1 animate-in slide-in-from-right-2 duration-200">
                                <input
                                  type="datetime-local"
                                  value={rescheduleDate}
                                  onChange={(e) => setRescheduleDate(e.target.value)}
                                  className="px-1.5 py-1 border border-slate-200 rounded-lg text-[9px] font-bold outline-none focus:ring-2 focus:ring-amber-500"
                                />
                                <button
                                  onClick={() => handleReschedule(tx)}
                                  disabled={loading === tx.id}
                                  className="p-1 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50"
                                >
                                  <CheckCircle2 size={14} />
                                </button>
                                <button
                                  onClick={() => setReschedulingId(null)}
                                  className="p-1 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
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
