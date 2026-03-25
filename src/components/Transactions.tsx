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
  Timestamp
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Transaction, Item, Category, TransactionType, OperationType } from '../types';
import { handleFirestoreError } from '../utils/error-handler';
import { toast } from 'react-hot-toast';
import { 
  Plus, 
  ArrowDownCircle, 
  ArrowUpCircle, 
  Search, 
  Filter, 
  Download, 
  Calendar as CalendarIcon,
  Package,
  MapPin,
  User as UserIcon,
  X
} from 'lucide-react';
import { format } from 'date-fns';
import * as XLSX from 'xlsx';

export default function Transactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalType, setModalType] = useState<TransactionType>('IN');
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('ALL');

  const [formData, setFormData] = useState({
    itemId: '',
    quantity: 1,
    invoiceNo: '',
    sourceDestination: '',
    location: '',
    date: format(new Date(), "yyyy-MM-dd'T'HH:mm")
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
    return () => {
      unsubTx();
      unsubItems();
      unsubCats();
    };
  }, []);

  const generateVoucherNo = () => {
    const prefix = modalType === 'IN' ? 'VIN' : 'VOUT';
    const lastNum = transactions.length + 1;
    return `${prefix}-${String(lastNum).padStart(4, '0')}`;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.itemId) return toast.error('Please select an item');
    
    const selectedItem = items.find(i => i.id === formData.itemId);
    if (!selectedItem) return;

    if (modalType === 'OUT' && selectedItem.currentStock < formData.quantity) {
      return toast.error(`Insufficient stock! Current stock: ${selectedItem.currentStock}`);
    }

    setLoading(true);
    try {
      const voucherNo = generateVoucherNo();
      const txData = {
        ...formData,
        voucherNo,
        type: modalType,
        createdBy: auth.currentUser?.uid,
        date: new Date(formData.date).toISOString()
      };

      await runTransaction(db, async (transaction) => {
        const itemRef = doc(db, 'items', formData.itemId);
        const itemSnap = await transaction.get(itemRef);
        
        if (!itemSnap.exists()) throw new Error("Item does not exist!");
        
        const currentStock = itemSnap.data().currentStock;
        const newStock = modalType === 'IN' ? currentStock + formData.quantity : currentStock - formData.quantity;
        
        if (newStock < 0) throw new Error("Insufficient stock!");

        transaction.set(doc(collection(db, 'transactions')), txData);
        transaction.update(itemRef, { currentStock: newStock });
      });

      toast.success(`${modalType === 'IN' ? 'Stock In' : 'Stock Out'} recorded successfully`);
      closeModal();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'transactions');
    } finally {
      setLoading(false);
    }
  };

  const openModal = (type: TransactionType) => {
    setModalType(type);
    setFormData({
      itemId: '',
      quantity: 1,
      invoiceNo: '',
      sourceDestination: '',
      location: '',
      date: format(new Date(), "yyyy-MM-dd'T'HH:mm")
    });
    setIsModalOpen(true);
  };

  const closeModal = () => setIsModalOpen(false);

  const filteredTransactions = transactions.filter(tx => {
    const item = items.find(i => i.id === tx.itemId);
    const matchesSearch = item?.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         tx.voucherNo.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = filterType === 'ALL' || tx.type === filterType;
    return matchesSearch && matchesType;
  });

  const exportToExcel = () => {
    const data = filteredTransactions.map(tx => {
      const item = items.find(i => i.id === tx.itemId);
      const category = categories.find(c => c.id === item?.categoryId);
      return {
        'Voucher No': tx.voucherNo,
        'Invoice/PI No': tx.invoiceNo || '-',
        'Date': format(new Date(tx.date), 'yyyy-MM-dd HH:mm'),
        'Type': tx.type,
        'Item Name': item?.name || 'Unknown',
        'Category': category?.name || 'Unknown',
        'Quantity': tx.quantity,
        'Source/Destination': tx.sourceDestination || '-',
        'Location': tx.location || '-',
        'Created By': tx.createdBy
      };
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transactions");
    XLSX.writeFile(wb, `Inventory_Transactions_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success('Exported successfully');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Transaction History</h1>
          <p className="text-slate-500">Track all stock movements and vouchers</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button 
            onClick={() => openModal('IN')}
            className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20"
          >
            <ArrowDownCircle size={20} />
            <span>Stock IN</span>
          </button>
          <button 
            onClick={() => openModal('OUT')}
            className="flex items-center gap-2 bg-rose-600 text-white px-4 py-2 rounded-lg hover:bg-rose-700 transition-colors shadow-lg shadow-rose-600/20"
          >
            <ArrowUpCircle size={20} />
            <span>Stock OUT</span>
          </button>
          <button 
            onClick={exportToExcel}
            className="flex items-center gap-2 bg-white border border-slate-200 px-4 py-2 rounded-lg text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
          >
            <Download size={18} />
            <span>Export Excel</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Search by item or voucher..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={18} className="text-slate-400" />
          <select 
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/20 outline-none"
          >
            <option value="ALL">All Types</option>
            <option value="IN">Stock IN</option>
            <option value="OUT">Stock OUT</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                <th className="px-6 py-4 font-semibold">Voucher No</th>
                <th className="px-6 py-4 font-semibold">Invoice/PI</th>
                <th className="px-6 py-4 font-semibold">Date</th>
                <th className="px-6 py-4 font-semibold">Type</th>
                <th className="px-6 py-4 font-semibold">Item</th>
                <th className="px-6 py-4 font-semibold">Quantity</th>
                <th className="px-6 py-4 font-semibold">Source/Dest</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredTransactions.map((tx) => {
                const item = items.find(i => i.id === tx.itemId);
                return (
                  <tr key={tx.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 font-bold text-slate-900">{tx.voucherNo}</td>
                    <td className="px-6 py-4 text-sm text-slate-600 font-medium">{tx.invoiceNo || '-'}</td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      {format(new Date(tx.date), 'MMM dd, yyyy HH:mm')}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        tx.type === 'IN' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                      }`}>
                        {tx.type === 'IN' ? <ArrowDownCircle size={12} /> : <ArrowUpCircle size={12} />}
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-semibold text-slate-900">{item?.name || 'Unknown'}</span>
                        <span className="text-xs text-slate-500">{categories.find(c => c.id === item?.categoryId)?.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-bold text-slate-900">{tx.quantity}</span>
                      <span className="text-xs text-slate-500 ml-1">{item?.unit}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 truncate max-w-[150px]">
                      {tx.sourceDestination || '-'}
                    </td>
                  </tr>
                );
              })}
              {filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">
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
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className={`p-6 border-b border-slate-100 flex items-center justify-between ${
              modalType === 'IN' ? 'bg-emerald-50' : 'bg-rose-50'
            }`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${
                  modalType === 'IN' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                }`}>
                  {modalType === 'IN' ? <ArrowDownCircle size={24} /> : <ArrowUpCircle size={24} />}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">
                    Material {modalType} Entry
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">Voucher: {generateVoucherNo()}</p>
                </div>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600">
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Select Item</label>
                  <div className="relative">
                    <Package className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <select
                      required
                      value={formData.itemId}
                      onChange={(e) => setFormData({ ...formData, itemId: e.target.value })}
                      className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all appearance-none bg-white"
                    >
                      <option value="">Choose an item...</option>
                      {items.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.name} (Stock: {item.currentStock} {item.unit})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Invoice / PI No</label>
                  <input
                    type="text"
                    value={formData.invoiceNo}
                    onChange={(e) => setFormData({ ...formData, invoiceNo: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                    placeholder="e.g. INV-2024-001"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Quantity</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) })}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
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
                      className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    {modalType === 'IN' ? 'Supplier / Source' : 'Destination / Usage'}
                  </label>
                  <input
                    type="text"
                    value={formData.sourceDestination}
                    onChange={(e) => setFormData({ ...formData, sourceDestination: e.target.value })}
                    className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                    placeholder={modalType === 'IN' ? 'e.g. ABC Suppliers' : 'e.g. Production Line A'}
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Location</label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                      type="text"
                      value={formData.location}
                      onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                      className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                      placeholder="e.g. Warehouse A, Shelf 4"
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 font-semibold rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className={`flex-1 text-white font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${
                    modalType === 'IN' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {loading ? (
                    <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <>
                      <Plus size={18} />
                      Submit {modalType}
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
