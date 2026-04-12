import React, { useState } from 'react';
import { Upload, FileText, CheckCircle2, Loader2, Trash2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { Project, ProjectStatus, OperationType } from '../types';
import { toast } from 'react-hot-toast';
import { handleFirestoreError } from '../lib/firestoreErrorHandler';

export default function ProjectManagement() {
  const [uploading, setUploading] = useState(false);
  const [stats, setStats] = useState<{ total: number; added: number; mapping?: Record<string, string> } | null>(null);

  const standardizeStatus = (status: string): ProjectStatus => {
    const s = status?.trim().toLowerCase();
    if (!s) return 'New';
    if (s.includes('completed') || s.includes('done') || s.includes('finish')) return 'Completed';
    if (s.includes('wip') || s.includes('progress') || s.includes('working')) return 'WIP';
    if (s.includes('hold') || s.includes('pause') || s.includes('stop')) return 'On Hold';
    if (s.includes('delay') || s.includes('late')) return 'Delayed';
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

          const projects: Partial<Project>[] = [];
          const columnMapping: Record<string, string> = {};
          
          for (const row of jsonData) {
            const findVal = (keywords: string[], targetField: string) => {
              const keys = Object.keys(row);
              let key = keys.find(k => {
                const normalizedK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                return keywords.some(kw => kw.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedK);
              });

              if (!key) {
                key = keys.find(k => {
                  const normalizedK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                  return keywords.some(kw => {
                    const normalizedKW = kw.toLowerCase().replace(/[^a-z0-9]/g, '');
                    return normalizedK.includes(normalizedKW) || normalizedKW.includes(normalizedK);
                  });
                });
              }

              if (key && !columnMapping[targetField]) {
                columnMapping[targetField] = key;
              }
              return key ? row[key] : undefined;
            };

            const sNoRaw = findVal(['S. No', 'SNo', 'Serial', 'No', '#'], 'sNo');
            const salespersonRaw = findVal(['Sales Person Name', 'Salesperson', 'Sales Person', 'Owner', 'Assigned'], 'salespersonName');
            const siteNameRaw = findVal(['Site Name', 'Project Name', 'Site'], 'siteName');
            const projectCodeRaw = findVal(['Project Code', 'Code', 'ProjectID'], 'projectCode');
            const statusRaw = findVal(['Project Status', 'Status', 'Stage'], 'projectStatus');
            const locationRaw = findVal(['Site Location', 'Location', 'City'], 'siteLocation');
            const dimensionRaw = findVal(['Project Dimension', 'Dimension', 'Size', 'Area'], 'projectDimension');
            const detailsRaw = findVal(['Project Details', 'Details', 'Description'], 'projectDetails');
            const requirementsRaw = findVal(['Product Requirements', 'Requirements', 'Products'], 'productRequirements');
            const dispatchRaw = findVal(['Dispatch Details', 'Dispatch'], 'dispatchDetails');
            const remarksRaw = findVal(['Remarks', 'Notes', 'Comments'], 'remarks');
            const totalValueRaw = findVal(['Total Project Value', 'Project Value', 'Value', 'Amount'], 'totalProjectValue');
            const pendingPaymentRaw = findVal(['Pending Payment', 'Pending', 'Balance'], 'pendingPayment');

            if (!siteNameRaw && !projectCodeRaw) continue;

            const project: Partial<Project> = {
              sNo: parseInt(String(sNoRaw || 0)) || 0,
              salespersonName: String(salespersonRaw || 'Unknown'),
              siteName: String(siteNameRaw || 'N/A'),
              projectCode: String(projectCodeRaw || 'N/A'),
              projectStatus: standardizeStatus(String(statusRaw || 'New')),
              siteLocation: String(locationRaw || 'N/A'),
              projectDimension: String(dimensionRaw || 'N/A'),
              projectDetails: String(detailsRaw || 'N/A'),
              productRequirements: String(requirementsRaw || 'N/A'),
              dispatchDetails: String(dispatchRaw || 'N/A'),
              remarks: String(remarksRaw || ''),
              totalProjectValue: parseFloat(String(totalValueRaw || 0).replace(/[^0-9.]/g, '')) || 0,
              pendingPayment: parseFloat(String(pendingPaymentRaw || 0).replace(/[^0-9.]/g, '')) || 0,
              createdAt: new Date().toISOString()
            };
            projects.push(project);
          }

          const batchSize = 500;
          let addedCount = 0;
          
          for (let i = 0; i < projects.length; i += batchSize) {
            const batch = writeBatch(db);
            const chunk = projects.slice(i, i + batchSize);
            
            chunk.forEach(project => {
              const projectRef = doc(collection(db, 'projects'));
              batch.set(projectRef, project);
              addedCount++;
            });
            
            await batch.commit();
          }

          setStats({ total: projects.length, added: addedCount, mapping: columnMapping });
          toast.success(`Successfully uploaded ${addedCount} projects!`);
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'projects');
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

  const [showConfirmClear, setShowConfirmClear] = useState(false);

  const clearProjects = async () => {
    setUploading(true);
    try {
      const snap = await getDocs(collection(db, 'projects'));
      const batchSize = 500;
      const docs = snap.docs;
      
      if (docs.length === 0) {
        toast.error('No projects to clear');
        setUploading(false);
        setShowConfirmClear(false);
        return;
      }

      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = writeBatch(db);
        const chunk = docs.slice(i, i + batchSize);
        chunk.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
      
      toast.success('All projects data cleared');
      setStats(null);
      setShowConfirmClear(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'projects');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Project Data Management</h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Upload and manage project records</p>
          </div>
          {showConfirmClear ? (
            <div className="flex items-center gap-2 animate-in fade-in zoom-in-95">
              <button
                onClick={() => setShowConfirmClear(false)}
                className="px-3 py-2 bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={clearProjects}
                disabled={uploading}
                className="flex items-center gap-2 px-4 py-2 bg-rose-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-rose-700 transition-all shadow-sm shadow-rose-200 disabled:opacity-50"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                Confirm Delete
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowConfirmClear(true)}
              disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 bg-rose-50 text-rose-600 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-rose-100 transition-all disabled:opacity-50"
            >
              <Trash2 size={16} />
              Clear All Data
            </button>
          )}
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
                {uploading ? 'Processing Data...' : 'Upload Projects Excel'}
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
                'Required fields: Site Name or Project Code',
                'Status will be standardized (Completed, WIP, On Hold, Delayed)',
                'Financial fields will be cleaned automatically',
                'Empty rows will be skipped'
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
          <div className="mt-6 space-y-4 animate-in fade-in slide-in-from-top-2">
            <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center gap-4">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-emerald-600 shadow-sm">
                <FileText size={20} />
              </div>
              <div>
                <p className="text-[10px] font-black text-emerald-800 uppercase tracking-widest">Upload Complete</p>
                <p className="text-xs font-bold text-emerald-600 mt-0.5">
                  Processed {stats.total} rows, added {stats.added} projects to database.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">Required Column Mapping</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {[
            'S. No', 'Sales Person Name', 'Site Name', 'Project Code',
            'Project Status', 'Site Location', 'Project Dimension', 'Project Details',
            'Product Requirements', 'Dispatch Details', 'Remarks', 'Total Project Value',
            'Pending Payment'
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
