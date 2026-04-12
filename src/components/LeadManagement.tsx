import React, { useState } from 'react';
import { Upload, FileText, CheckCircle2, AlertCircle, Loader2, Trash2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { collection, addDoc, getDocs, query, where, writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { Lead, LeadStatus, OperationType } from '../types';
import { toast } from 'react-hot-toast';
import { format } from 'date-fns';
import { handleFirestoreError } from '../lib/firestoreErrorHandler';

export default function LeadManagement() {
  const [uploading, setUploading] = useState(false);
  const [stats, setStats] = useState<{ total: number; added: number } | null>(null);

  const standardizeStatus = (status: string): LeadStatus => {
    const s = status?.trim().toLowerCase();
    if (!s) return 'New';
    if (s.includes('new')) return 'New';
    if (s.includes('contacted')) return 'Contacted';
    if (s.includes('quote') || s.includes('sent')) return 'Quote Sent';
    if (s.includes('negotiation')) return 'Negotiation';
    if (s.includes('won') || s.includes('converted')) return 'Won';
    if (s.includes('lost')) return 'Lost';
    return 'New';
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setStats(null);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = new Uint8Array(event.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array', cellDates: true });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

          if (jsonData.length === 0) {
            toast.error('The uploaded file is empty');
            setUploading(false);
            return;
          }

          const leads: Partial<Lead>[] = [];
          
          for (const row of jsonData) {
            // Basic validation: skip if essential fields are missing
            if (!row['Lead Date'] && !row['Salesperson Name'] && !row['Billing Name']) continue;

            const formatDate = (val: any) => {
              if (val instanceof Date) return format(val, 'yyyy-MM-dd');
              if (typeof val === 'number') {
                // Excel dates are days since 1900-01-01
                const d = new Date((val - 25569) * 86400 * 1000);
                return format(d, 'yyyy-MM-dd');
              }
              if (typeof val === 'string') {
                const d = new Date(val);
                return isNaN(d.getTime()) ? format(new Date(), 'yyyy-MM-dd') : format(d, 'yyyy-MM-dd');
              }
              return format(new Date(), 'yyyy-MM-dd');
            };

            const lead: Partial<Lead> = {
              leadDate: formatDate(row['Lead Date']),
              salespersonName: String(row['Salesperson Name'] || 'Unknown'),
              leadSource: String(row['Lead Source'] || 'N/A'),
              billingName: String(row['Billing Name'] || 'N/A'),
              phoneNumber: String(row['Phone Number'] || ''),
              cityLocation: String(row['City/Location'] || 'N/A'),
              sport: String(row['Sport'] || 'N/A'),
              productInterestedIn: String(row['Product Interested In'] || 'N/A'),
              approxArea: parseFloat(String(row['Approx Area']).replace(/[^0-9.]/g, '')) || 0,
              estProjectValue: parseFloat(String(row['Est. Project Value']).replace(/[^0-9.]/g, '')) || 0,
              leadStatus: standardizeStatus(String(row['Lead Status'] || 'New')),
              nextFollowUp: row['Next Follow-up'] ? formatDate(row['Next Follow-up']) : '',
              lastRemark: String(row['Last Remark'] || ''),
              convertedToProject: (String(row['Converted to Project']).toLowerCase() === 'yes' || String(row['Lead Status']).toLowerCase().includes('won')) ? 'Yes' : 'No',
              projectId: String(row['Project ID'] || ''),
              month: String(row['Month'] || format(new Date(), 'MMMM')),
              createdAt: new Date().toISOString()
            };
            leads.push(lead);
          }

          // Batch upload to Firestore
          const batchSize = 500;
          let addedCount = 0;
          
          for (let i = 0; i < leads.length; i += batchSize) {
            const batch = writeBatch(db);
            const chunk = leads.slice(i, i + batchSize);
            
            chunk.forEach(lead => {
              const leadRef = doc(collection(db, 'leads'));
              batch.set(leadRef, lead);
              addedCount++;
            });
            
            await batch.commit();
          }

          setStats({ total: leads.length, added: addedCount });
          toast.success(`Successfully uploaded ${addedCount} leads!`);
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'leads');
        } finally {
          setUploading(false);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (error) {
      console.error('Error reading file:', error);
      toast.error('Failed to read file');
      setUploading(false);
    }
  };

  const clearLeads = async () => {
    if (!window.confirm('Are you sure you want to clear ALL leads data? This cannot be undone.')) return;
    
    setUploading(true);
    try {
      const snap = await getDocs(collection(db, 'leads'));
      const batchSize = 500;
      const docs = snap.docs;
      
      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + batchSize);
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      
      toast.success('All leads data cleared');
      setStats(null);
    } catch (error) {
      console.error('Error clearing leads:', error);
      toast.error('Failed to clear leads data');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Leads Data Management</h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Upload and manage sales leads</p>
          </div>
          <button
            onClick={clearLeads}
            disabled={uploading}
            className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-rose-100 transition-all disabled:opacity-50"
          >
            <Trash2 size={16} />
            Clear All Data
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center hover:border-blue-400 transition-all group relative">
            <input
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleFileUpload}
              disabled={uploading}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                {uploading ? <Loader2 size={32} className="animate-spin" /> : <Upload size={32} />}
              </div>
              <p className="text-sm font-black text-slate-900 uppercase tracking-tight">
                {uploading ? 'Processing Data...' : 'Upload Leads Excel'}
              </p>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-2">
                Drag and drop or click to browse
              </p>
            </div>
          </div>

          <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Upload Instructions</h3>
            <ul className="space-y-3">
              {[
                'Use .xlsx, .xls or .csv format',
                'Ensure headers match exactly (Lead Date, Salesperson Name, etc.)',
                'Lead Status will be automatically standardized',
                'Numeric fields (Area, Value) will be cleaned',
                'Empty rows will be skipped automatically'
              ].map((text, i) => (
                <li key={i} className="flex items-start gap-3">
                  <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                  <span className="text-[11px] font-bold text-slate-600 leading-relaxed">{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {stats && (
          <div className="mt-6 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-2">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-emerald-600 shadow-sm">
              <FileText size={20} />
            </div>
            <div>
              <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">Upload Complete</p>
              <p className="text-xs font-bold text-emerald-600 mt-0.5">
                Processed {stats.total} rows, added {stats.added} leads to database.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Required Column Mapping</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {[
            'Lead Date', 'Salesperson Name', 'Lead Source', 'Billing Name',
            'Phone Number', 'City/Location', 'Sport', 'Product Interested In',
            'Approx Area', 'Est. Project Value', 'Lead Status', 'Next Follow-up',
            'Last Remark', 'Converted to Project', 'Project ID', 'Month'
          ].map(col => (
            <div key={col} className="px-3 py-2 bg-slate-50 rounded-lg border border-slate-100 text-[10px] font-bold text-slate-600">
              {col}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
