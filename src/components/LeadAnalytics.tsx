import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend, FunnelChart, Funnel, LabelList,
  AreaChart, Area
} from 'recharts';
import { 
  TrendingUp, Users, Target, MapPin, Calendar, Filter, 
  CheckCircle2, Clock, AlertCircle, DollarSign, BarChart3,
  ChevronRight, ArrowUpRight, ArrowDownRight, RefreshCw
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { Lead, LeadStatus, OperationType } from '../types';
import { format, parseISO, isWithinInterval, startOfDay, endOfDay, isAfter, isBefore, isValid, min, max } from 'date-fns';
import { handleFirestoreError } from '../lib/firestoreErrorHandler';

const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#14B8A6'];
const STATUS_COLORS: Record<string, string> = {
  'New': '#2563EB',
  'Contacted': '#8B5CF6',
  'Quote Sent': '#F59E0B',
  'Negotiation': '#06B6D4',
  'Won': '#10B981',
  'Lost': '#EF4444'
};

export default function LeadAnalytics() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [selectedSalesperson, setSelectedSalesperson] = useState('all');
  const [selectedSource, setSelectedSource] = useState('all');
  const [selectedCity, setSelectedCity] = useState('all');
  const [selectedProduct, setSelectedProduct] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  useEffect(() => {
    let unsub: (() => void) | undefined;
    
    const subscribe = () => {
      setLoading(true);
      setError(null);
      
      try {
        unsub = onSnapshot(
          collection(db, 'leads'),
          (snap) => {
            setLeads(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Lead)));
            setLoading(false);
            setError(null);
          },
          (err) => {
            console.error('Lead Analytics Error:', err);
            setError(err.message);
            setLoading(false);
            try {
              handleFirestoreError(err, OperationType.LIST, 'leads');
            } catch (e) {
              // Error already logged
            }
          }
        );
      } catch (err: any) {
        console.error('Lead Analytics Subscription Error:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    subscribe();
    return () => {
      if (unsub) unsub();
    };
  }, []);

  const leadsDataRange = useMemo(() => {
    if (leads.length === 0) return null;
    const dates = leads.map(lead => {
      let d: Date | null = null;
      if (!lead.leadDate) return null;
      if ((lead.leadDate as any) instanceof Date) d = lead.leadDate as any;
      else if (typeof lead.leadDate === 'string') {
        d = parseISO(lead.leadDate);
        if (!isValid(d)) d = new Date(lead.leadDate);
      } else if (typeof lead.leadDate === 'object' && (lead.leadDate as any).toDate) {
        d = (lead.leadDate as any).toDate();
      }
      return d && isValid(d) ? d : null;
    }).filter((d): d is Date => d !== null);

    if (dates.length === 0) return null;
    return {
      start: min(dates),
      end: max(dates)
    };
  }, [leads]);

  const filteredLeads = useMemo(() => {
    return leads.filter(lead => {
      // 1. Date Match Logic (String-based comparison is safer for YYYY-MM-DD)
      let isDateMatch = true;
      if (dateRange.start || dateRange.end) {
        let leadDateStr = '';
        if (typeof lead.leadDate === 'string') {
          leadDateStr = lead.leadDate.split('T')[0];
        } else if ((lead.leadDate as any) instanceof Date) {
          leadDateStr = format(lead.leadDate as any, 'yyyy-MM-dd');
        } else if (typeof lead.leadDate === 'object' && (lead.leadDate as any).toDate) {
          leadDateStr = format((lead.leadDate as any).toDate(), 'yyyy-MM-dd');
        }

        if (leadDateStr) {
          const start = dateRange.start || '0000-00-00';
          const end = dateRange.end || '9999-99-99';
          isDateMatch = leadDateStr >= start && leadDateStr <= end;
        } else {
          isDateMatch = false;
        }
      }

      if (!isDateMatch) return false;

      // 2. Other Filters (Case-Insensitive)
      const salespersonMatch = selectedSalesperson === 'all' || 
        String(lead.salespersonName || '').toLowerCase() === selectedSalesperson.toLowerCase();
      
      const sourceMatch = selectedSource === 'all' || 
        String(lead.leadSource || '').toLowerCase() === selectedSource.toLowerCase();
      
      const cityMatch = selectedCity === 'all' || 
        String(lead.cityLocation || '').toLowerCase() === selectedCity.toLowerCase();
      
      const productMatch = selectedProduct === 'all' || 
        String(lead.productInterestedIn || '').toLowerCase() === selectedProduct.toLowerCase();
      
      const statusMatch = selectedStatus === 'all' || 
        String(lead.leadStatus || '').toLowerCase() === selectedStatus.toLowerCase();

      return salespersonMatch && sourceMatch && cityMatch && productMatch && statusMatch;
    });
  }, [leads, dateRange, selectedSalesperson, selectedSource, selectedCity, selectedProduct, selectedStatus]);

  const stats = useMemo(() => {
    // Strictly define Won as status 'Won'
    const isWon = (l: any) => String(l?.leadStatus || '').toLowerCase() === 'won';
    const isLost = (l: any) => String(l?.leadStatus || '').toLowerCase() === 'lost';

    const total = filteredLeads.length;
    const wonLeads = filteredLeads.filter(isWon);
    const won = wonLeads.length;
    const lost = filteredLeads.filter(isLost).length;
    
    // Conversion Rate = (Won / Total) * 100
    const conversionRate = total > 0 ? (won / total) * 100 : 0;
    
    // Pipeline Value = Sum of values for leads that are NOT Won and NOT Lost
    const pipelineValue = filteredLeads
      .filter(l => !isWon(l) && !isLost(l))
      .reduce((acc, l) => acc + (Number(l?.estProjectValue) || 0), 0);
    
    // Won Value = Sum of values for WON leads only
    const wonValue = wonLeads.reduce((acc, l) => acc + (Number(l?.estProjectValue) || 0), 0);
    
    // Avg Deal Size = Won Value / Won Count
    const avgDealSize = won > 0 ? wonValue / won : 0;

    const today = startOfDay(new Date());
    const overdueFollowups = filteredLeads.filter(l => {
      if (!l || isWon(l) || isLost(l) || !l.nextFollowUp) return false;
      try {
        const d = parseISO(l.nextFollowUp);
        return !isNaN(d.getTime()) && isBefore(d, today);
      } catch (e) {
        return false;
      }
    }).length;

    return { total, won, lost, conversionRate, pipelineValue, wonValue, avgDealSize, overdueFollowups };
  }, [filteredLeads]);

  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredLeads.forEach(l => {
      if (!l?.leadStatus) return;
      counts[l.leadStatus] = (counts[l.leadStatus] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredLeads]);

  const sourceData = useMemo(() => {
    const data: Record<string, { count: number; won: number }> = {};
    filteredLeads.forEach(l => {
      const source = l?.leadSource || 'N/A';
      if (!data[source]) data[source] = { count: 0, won: 0 };
      data[source].count++;
      if (l?.leadStatus === 'Won') data[source].won++;
    });
    return Object.entries(data)
      .map(([name, d]) => ({
        name,
        count: d.count,
        rate: (d.won / d.count) * 100
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
  }, [filteredLeads]);

  const salespersonData = useMemo(() => {
    const data: Record<string, { total: number; won: number }> = {};
    filteredLeads.forEach(l => {
      const name = l?.salespersonName || 'Unknown';
      if (!data[name]) data[name] = { total: 0, won: 0 };
      data[name].total++;
      if (String(l?.leadStatus || '').toLowerCase() === 'won') data[name].won++;
    });
    return Object.entries(data)
      .map(([name, d]) => ({
        name,
        total: d.total,
        won: d.won,
        rate: d.total > 0 ? (d.won / d.total) * 100 : 0
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
  }, [filteredLeads]);

  const funnelData = useMemo(() => {
    const stages = ['New', 'Contacted', 'Quote Sent', 'Negotiation', 'Won'];
    return stages.map(stage => ({
      name: stage,
      value: filteredLeads.filter(l => {
        if (!l?.leadStatus) return false;
        const stageIdx = stages.indexOf(stage);
        const leadStageIdx = stages.indexOf(l.leadStatus);
        return leadStageIdx >= stageIdx;
      }).length,
      fill: STATUS_COLORS[stage]
    }));
  }, [filteredLeads]);

  const productData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredLeads.forEach(l => {
      const p = l?.productInterestedIn || 'Unknown';
      counts[p] = (counts[p] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
  }, [filteredLeads]);

  const cityData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredLeads.forEach(l => {
      const c = l?.cityLocation || 'Unknown';
      counts[c] = (counts[c] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
  }, [filteredLeads]);

  const uniqueSalespersons = useMemo(() => Array.from(new Set(leads.map(l => l?.salespersonName).filter(Boolean))), [leads]);
  const uniqueSources = useMemo(() => Array.from(new Set(leads.map(l => l?.leadSource).filter(Boolean))), [leads]);
  const uniqueCities = useMemo(() => Array.from(new Set(leads.map(l => l?.cityLocation).filter(Boolean))), [leads]);
  const uniqueProducts = useMemo(() => Array.from(new Set(leads.map(l => l?.productInterestedIn).filter(Boolean))), [leads]);

  const resetFilters = () => {
    setSelectedSalesperson('all');
    setSelectedSource('all');
    setSelectedCity('all');
    setSelectedProduct('all');
    setSelectedStatus('all');
    setDateRange({ start: '', end: '' });
  };

  const setQuickRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    setDateRange({
      start: format(start, 'yyyy-MM-dd'),
      end: format(end, 'yyyy-MM-dd')
    });
  };

  const setMonthRange = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    setDateRange({
      start: format(start, 'yyyy-MM-dd'),
      end: format(now, 'yyyy-MM-dd')
    });
  };

  const isAnyFilterActive = selectedSalesperson !== 'all' || 
                           selectedSource !== 'all' || 
                           selectedCity !== 'all' || 
                           selectedProduct !== 'all' || 
                           selectedStatus !== 'all' || 
                           dateRange.start !== '' || 
                           dateRange.end !== '';

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-3xl border border-slate-100 p-8 text-center">
      <div className="w-16 h-16 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center mb-4">
        <AlertCircle size={32} />
      </div>
      <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Access Denied or Error</h3>
      <p className="text-sm text-slate-500 font-bold mt-2 max-w-md">
        {error.includes('permission-denied') 
          ? "You don't have permission to view lead analytics. Please contact your administrator."
          : "There was an error loading the analytics data. Please try again later."}
      </p>
      <div className="mt-6 p-4 bg-slate-50 rounded-xl text-[10px] font-mono text-slate-400 break-all max-w-lg mb-6">
        {error}
      </div>
      <button 
        onClick={() => window.location.reload()}
        className="px-6 py-2 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-all"
      >
        Retry Connection
      </button>
    </div>
  );

  if (leads.length === 0) return (
    <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-3xl border border-slate-100 p-8 text-center">
      <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4">
        <Users size={32} />
      </div>
      <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">No Leads Data Found</h3>
      <p className="text-sm text-slate-500 font-bold mt-2 max-w-md">
        Upload your leads Excel file in the Settings {'>'} Leads Data section to see analytics here.
      </p>
    </div>
  );

  if (leads.length > 0 && filteredLeads.length === 0) {
    return (
      <div className="space-y-6 pb-10">
        {/* Header & Filters (Always visible) */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Lead Analytics</h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Performance and conversion insights</p>
              <span className="text-[9px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-black uppercase tracking-tighter">
                {leads.length} Total Leads
              </span>
              {leadsDataRange && (
                <span className="text-[9px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-black uppercase tracking-tighter">
                  Data: {format(leadsDataRange.start, 'MMM d, yyyy')} - {format(leadsDataRange.end, 'MMM d, yyyy')}
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button 
              onClick={() => window.location.reload()}
              className="p-2 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all shadow-sm"
              title="Refresh Data"
            >
              <RefreshCw size={16} />
            </button>
            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
              <button onClick={() => setQuickRange(7)} className="px-2 py-1 text-[9px] font-black uppercase hover:bg-slate-50 rounded-lg transition-all">7D</button>
              <button onClick={() => setQuickRange(30)} className="px-2 py-1 text-[9px] font-black uppercase hover:bg-slate-50 rounded-lg transition-all">30D</button>
              <button onClick={setMonthRange} className="px-2 py-1 text-[9px] font-black uppercase hover:bg-slate-50 rounded-lg transition-all">MTD</button>
            </div>
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm focus-within:border-blue-500 transition-all">
              <Calendar size={14} className="text-slate-400" />
              <div className="flex items-center gap-1">
                <span className="text-[8px] font-black text-slate-400 uppercase">From</span>
                <input 
                  type="date" 
                  value={dateRange.start}
                  onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                  className="text-[10px] font-black uppercase outline-none bg-transparent cursor-pointer"
                />
              </div>
              <span className="text-slate-300">|</span>
              <div className="flex items-center gap-1">
                <span className="text-[8px] font-black text-slate-400 uppercase">To</span>
                <input 
                  type="date" 
                  value={dateRange.end}
                  onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                  className="text-[10px] font-black uppercase outline-none bg-transparent cursor-pointer"
                />
              </div>
            </div>
            <select 
              value={selectedSalesperson}
              onChange={e => setSelectedSalesperson(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-[10px] font-black uppercase outline-none shadow-sm"
            >
              <option value="all">All Salespersons</option>
              {uniqueSalespersons.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select 
              value={selectedSource}
              onChange={e => setSelectedSource(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-[10px] font-black uppercase outline-none shadow-sm"
            >
              <option value="all">All Sources</option>
              {uniqueSources.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select 
              value={selectedCity}
              onChange={e => setSelectedCity(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-[10px] font-black uppercase outline-none shadow-sm"
            >
              <option value="all">All Cities</option>
              {uniqueCities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select 
              value={selectedProduct}
              onChange={e => setSelectedProduct(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-[10px] font-black uppercase outline-none shadow-sm"
            >
              <option value="all">All Products</option>
              {uniqueProducts.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            {isAnyFilterActive && (
              <button 
                onClick={resetFilters}
                className="px-4 py-2 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-all shadow-sm"
              >
                Clear Filters
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center justify-center min-h-[400px] bg-white rounded-3xl border border-slate-100 p-8 text-center">
          <div className="w-16 h-16 bg-slate-50 text-slate-400 rounded-2xl flex items-center justify-center mb-4">
            <Filter size={32} />
          </div>
          <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">No Leads Match Your Filters</h3>
          <p className="text-sm text-slate-500 font-bold mt-2 max-w-md">
            We found {leads.length} leads in total, but none match the current filters.
          </p>

          {leadsDataRange && dateRange.start && !dateRange.start.startsWith(String(leadsDataRange.start.getFullYear())) && (
            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 text-left max-w-lg">
              <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={18} />
              <div>
                <p className="text-xs font-black text-amber-900 uppercase tracking-tight">Year Mismatch Detected</p>
                <p className="text-[11px] font-bold text-amber-700 mt-1">
                  Your data is from the year <span className="underline">{leadsDataRange.start.getFullYear()}</span>, but you are filtering for <span className="underline">{dateRange.start.split('-')[0]}</span>. 
                </p>
                <button 
                  onClick={() => {
                    const year = leadsDataRange.start.getFullYear();
                    setDateRange(prev => ({
                      start: prev.start ? `${year}${prev.start.substring(4)}` : '',
                      end: prev.end ? `${year}${prev.end.substring(4)}` : ''
                    }));
                  }}
                  className="mt-2 px-3 py-1 bg-amber-200 text-amber-900 text-[9px] font-black uppercase rounded-lg hover:bg-amber-300 transition-all"
                >
                  Switch Filter to {leadsDataRange.start.getFullYear()}
                </button>
              </div>
            </div>
          )}
          
          <div className="mt-8 p-6 bg-slate-50 rounded-2xl border border-slate-100 text-left max-w-lg w-full">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Active Filters Debug</h4>
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] font-bold">
                <span className="text-slate-400 uppercase">Date Range:</span>
                <span className="text-slate-900">{dateRange.start || 'Any'} to {dateRange.end || 'Any'}</span>
              </div>
              <div className="flex justify-between text-[10px] font-bold">
                <span className="text-slate-400 uppercase">Salesperson:</span>
                <span className="text-slate-900">{selectedSalesperson}</span>
              </div>
              <div className="flex justify-between text-[10px] font-bold">
                <span className="text-slate-400 uppercase">City:</span>
                <span className="text-slate-900">{selectedCity}</span>
              </div>
              <div className="flex justify-between text-[10px] font-bold">
                <span className="text-slate-400 uppercase">Product:</span>
                <span className="text-slate-900">{selectedProduct}</span>
              </div>
              <div className="flex justify-between text-[10px] font-bold">
                <span className="text-slate-400 uppercase">Status:</span>
                <span className="text-slate-900">{selectedStatus}</span>
              </div>
            </div>
            <button 
              onClick={resetFilters}
              className="mt-6 w-full py-3 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-all shadow-sm"
            >
              Reset All Filters
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Header & Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Lead Analytics</h1>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Performance and conversion insights</p>
            <span className="text-[9px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-black uppercase tracking-tighter">
              {leads.length} Total Leads
            </span>
            {leadsDataRange && (
              <span className="text-[9px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-black uppercase tracking-tighter">
                Data: {format(leadsDataRange.start, 'MMM d, yyyy')} - {format(leadsDataRange.end, 'MMM d, yyyy')}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button 
            onClick={() => window.location.reload()}
            className="p-2 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all shadow-sm"
            title="Refresh Data"
          >
            <RefreshCw size={16} />
          </button>
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
            <button onClick={() => setQuickRange(7)} className="px-2 py-1 text-[9px] font-black uppercase hover:bg-slate-50 rounded-lg transition-all">7D</button>
            <button onClick={() => setQuickRange(30)} className="px-2 py-1 text-[9px] font-black uppercase hover:bg-slate-50 rounded-lg transition-all">30D</button>
            <button onClick={setMonthRange} className="px-2 py-1 text-[9px] font-black uppercase hover:bg-slate-50 rounded-lg transition-all">MTD</button>
          </div>
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm focus-within:border-blue-500 transition-all">
            <Calendar size={14} className="text-slate-400" />
            <div className="flex items-center gap-1">
              <span className="text-[8px] font-black text-slate-400 uppercase">From</span>
              <input 
                type="date" 
                value={dateRange.start}
                onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="text-[10px] font-black uppercase outline-none bg-transparent cursor-pointer"
              />
            </div>
            <span className="text-slate-300">|</span>
            <div className="flex items-center gap-1">
              <span className="text-[8px] font-black text-slate-400 uppercase">To</span>
              <input 
                type="date" 
                value={dateRange.end}
                onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="text-[10px] font-black uppercase outline-none bg-transparent cursor-pointer"
              />
            </div>
          </div>
          <select 
            value={selectedSalesperson}
            onChange={e => setSelectedSalesperson(e.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-[10px] font-black uppercase outline-none shadow-sm"
          >
            <option value="all">All Salespersons</option>
            {uniqueSalespersons.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select 
            value={selectedSource}
            onChange={e => setSelectedSource(e.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-[10px] font-black uppercase outline-none shadow-sm"
          >
            <option value="all">All Sources</option>
            {uniqueSources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select 
            value={selectedCity}
            onChange={e => setSelectedCity(e.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-[10px] font-black uppercase outline-none shadow-sm"
          >
            <option value="all">All Cities</option>
            {uniqueCities.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select 
            value={selectedProduct}
            onChange={e => setSelectedProduct(e.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-[10px] font-black uppercase outline-none shadow-sm"
          >
            <option value="all">All Products</option>
            {uniqueProducts.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {isAnyFilterActive && (
            <button 
              onClick={resetFilters}
              className="px-4 py-2 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-slate-800 transition-all shadow-sm"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Leads', value: stats.total.toLocaleString(), icon: Users, color: 'blue', subtext: 'Total leads in current view' },
          { label: 'Conversion Rate', value: `${stats.conversionRate.toFixed(1)}%`, icon: Target, color: 'emerald', subtext: `${stats.won} Won out of ${stats.total} Total` },
          { label: 'Pipeline Value', value: `₹${(stats.pipelineValue / 100000).toFixed(1)}L`, icon: DollarSign, color: 'amber', subtext: 'Excludes Won & Lost leads' },
          { label: 'Avg Deal Size', value: `₹${(stats.avgDealSize / 100000).toFixed(1)}L`, icon: TrendingUp, color: 'indigo', subtext: `Based on ₹${(stats.wonValue / 100000).toFixed(1)}L from ${stats.won} Won` }
        ].map((kpi, i) => (
          <div key={i} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 flex flex-col justify-between min-h-[140px]">
            <div className={`w-10 h-10 rounded-xl bg-${kpi.color}-50 text-${kpi.color}-600 flex items-center justify-center mb-4`}>
              <kpi.icon size={20} />
            </div>
            <div>
              <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.15em]">{kpi.label}</p>
              <p className="text-2xl font-black text-slate-900 leading-none mt-1">{kpi.value}</p>
              {kpi.subtext && (
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-2">
                  {kpi.subtext}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lead Funnel */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">Lead Conversion Funnel</h3>
            <BarChart3 size={18} className="text-slate-400" />
          </div>
          <div className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <FunnelChart>
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ fontSize: '12px', fontWeight: 700 }}
                />
                <Funnel
                  data={funnelData}
                  dataKey="value"
                  nameKey="name"
                  onClick={(data) => data && setSelectedStatus(data.name)}
                  cursor="pointer"
                >
                  <LabelList position="right" fill="#64748B" stroke="none" dataKey="name" fontSize={10} fontWeight={900} />
                  <LabelList position="center" fill="#FFFFFF" stroke="none" dataKey="value" fontSize={12} fontWeight={900} />
                </Funnel>
              </FunnelChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status Distribution */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight mb-8">Status Distribution</h3>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                  onClick={(data) => data && setSelectedStatus(data.name)}
                  cursor="pointer"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={STATUS_COLORS[entry.name] || COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 700 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between p-3 bg-rose-50 rounded-xl border border-rose-100">
              <div className="flex items-center gap-3">
                <AlertCircle size={16} className="text-rose-600" />
                <span className="text-[10px] font-black text-rose-900 uppercase tracking-widest">Overdue Follow-ups</span>
              </div>
              <span className="text-sm font-black text-rose-600">{stats.overdueFollowups}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Source Performance */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight mb-8">Lead Source Performance</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sourceData} layout="vertical" margin={{ left: 60, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#F1F5F9" />
                <XAxis type="number" hide />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  axisLine={false} 
                  tickLine={false} 
                  width={100}
                  tick={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }} 
                />
                <Tooltip 
                  cursor={{ fill: '#F8FAFC' }}
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                />
                <Bar 
                  dataKey="count" 
                  fill="#2563EB" 
                  radius={[0, 4, 4, 0]} 
                  barSize={20}
                  onClick={(data) => data && setSelectedSource(data.name)}
                  cursor="pointer"
                >
                  <LabelList dataKey="count" position="right" style={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }} offset={10} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Salesperson Performance */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight mb-8">Salesperson Performance</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salespersonData} layout="vertical" margin={{ left: 60, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#F1F5F9" />
                <XAxis type="number" hide />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  axisLine={false} 
                  tickLine={false} 
                  width={100}
                  tick={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }} 
                />
                <Tooltip 
                  cursor={{ fill: '#F8FAFC' }}
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                />
                <Bar 
                  dataKey="total" 
                  fill="#E2E8F0" 
                  radius={[0, 4, 4, 0]} 
                  barSize={20}
                  onClick={(data) => data && setSelectedSalesperson(data.name)}
                  cursor="pointer"
                >
                  <LabelList dataKey="total" position="right" style={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }} offset={10} />
                </Bar>
                <Bar 
                  dataKey="won" 
                  fill="#10B981" 
                  radius={[0, 4, 4, 0]} 
                  barSize={20}
                  onClick={(data) => data && setSelectedSalesperson(data.name)}
                  cursor="pointer"
                >
                  <LabelList dataKey="won" position="right" style={{ fill: '#059669', fontSize: 10, fontWeight: 700 }} offset={10} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Product Interest */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight mb-8">Product Interest Analysis</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={productData} margin={{ bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  interval={0}
                  angle={-45}
                  textAnchor="end"
                  tick={{ fill: '#64748B', fontSize: 9, fontWeight: 700 }} 
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }} />
                <Tooltip cursor={{ fill: '#F8FAFC' }} />
                <Bar 
                  dataKey="value" 
                  fill="#06B6D4" 
                  radius={[4, 4, 0, 0]}
                  onClick={(data) => data && setSelectedProduct(data.name)}
                  cursor="pointer"
                >
                  <LabelList dataKey="value" position="top" style={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }} offset={10} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* City Distribution */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight mb-8">City-wise Lead Distribution</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={cityData} margin={{ bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#F1F5F9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  interval={0}
                  angle={-45}
                  textAnchor="end"
                  tick={{ fill: '#64748B', fontSize: 9, fontWeight: 700 }} 
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }} />
                <Tooltip cursor={{ fill: '#F8FAFC' }} />
                <Bar 
                  dataKey="value" 
                  fill="#F59E0B" 
                  radius={[4, 4, 0, 0]}
                  onClick={(data) => data && setSelectedCity(data.name)}
                  cursor="pointer"
                >
                  <LabelList dataKey="value" position="top" style={{ fill: '#64748B', fontSize: 10, fontWeight: 700 }} offset={10} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
