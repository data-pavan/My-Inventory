import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell, Legend, LineChart, Line, LabelList
} from 'recharts';
import { 
  TrendingUp, Users, MapPin, Package, AlertCircle, 
  Eye, EyeOff, DollarSign, CreditCard, Activity,
  Calendar, Filter, RefreshCw, CheckCircle2
} from 'lucide-react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { Project, OperationType } from '../types';
import { handleFirestoreError } from '../lib/firestoreErrorHandler';
import { format, startOfMonth, endOfMonth, eachMonthOfInterval, subMonths, isWithinInterval } from 'date-fns';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

export default function ProjectAnalytics() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [hideFinancials, setHideFinancials] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projectsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Project[];
      setProjects(projectsData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'projects');
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // 1. Project Status Distribution
  const statusData = useMemo(() => {
    const counts: Record<string, number> = {};
    projects.forEach(p => {
      counts[p.projectStatus] = (counts[p.projectStatus] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [projects]);

  // 2. Salesperson Performance
  const salespersonData = useMemo(() => {
    const counts: Record<string, number> = {};
    projects.forEach(p => {
      counts[p.salespersonName] = (counts[p.salespersonName] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [projects]);

  // 3. Location-wise Projects
  const locationData = useMemo(() => {
    const counts: Record<string, number> = {};
    projects.forEach(p => {
      counts[p.siteLocation] = (counts[p.siteLocation] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [projects]);

  // 4. Delayed Projects
  const delayedProjects = useMemo(() => {
    return projects.filter(p => 
      p.projectStatus === 'Delayed' || 
      p.remarks?.toLowerCase().includes('delay') ||
      p.remarks?.toLowerCase().includes('pending')
    );
  }, [projects]);

  // 6. Project Trends (Monthly)
  const trendData = useMemo(() => {
    const last6Months = eachMonthOfInterval({
      start: subMonths(new Date(), 5),
      end: new Date()
    });

    return last6Months.map(month => {
      const monthStr = format(month, 'MMM yyyy');
      const count = projects.filter(p => {
        const date = new Date(p.createdAt);
        return isWithinInterval(date, {
          start: startOfMonth(month),
          end: endOfMonth(month)
        });
      }).length;
      return { month: monthStr, count };
    });
  }, [projects]);

  // Financial Data
  const financials = useMemo(() => {
    const totalValue = projects.reduce((sum, p) => sum + (p.totalProjectValue || 0), 0);
    const totalPending = projects.reduce((sum, p) => sum + (p.pendingPayment || 0), 0);
    const collectionEfficiency = totalValue > 0 ? ((totalValue - totalPending) / totalValue) * 100 : 0;

    const pendingByProject = projects
      .filter(p => p.pendingPayment > 0)
      .map(p => ({ name: p.siteName, pending: p.pendingPayment }))
      .sort((a, b) => b.pending - a.pending)
      .slice(0, 10);

    const highValueProjects = projects
      .map(p => ({ name: p.siteName, value: p.totalProjectValue }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    return { totalValue, totalPending, collectionEfficiency, pendingByProject, highValueProjects };
  }, [projects]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <RefreshCw className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-black text-slate-900 uppercase tracking-tight">Project Analytics</h1>
          <p className="text-xs text-slate-500 font-bold uppercase tracking-widest mt-1">Site performance and financial tracking</p>
        </div>
        
        <button 
          onClick={() => setHideFinancials(!hideFinancials)}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-sm ${
            hideFinancials 
              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' 
              : 'bg-slate-900 text-white hover:bg-slate-800'
          }`}
        >
          {hideFinancials ? <EyeOff size={14} /> : <Eye size={14} />}
          {hideFinancials ? 'Show Financial Data' : 'Hide Financial Data'}
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shadow-inner">
              <TrendingUp size={24} />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Projects</p>
              <h3 className="text-2xl font-black text-slate-900">{projects.length}</h3>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center shadow-inner">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Completed</p>
              <h3 className="text-2xl font-black text-slate-900">
                {projects.filter(p => p.projectStatus === 'Completed').length}
              </h3>
            </div>
          </div>
        </div>

        {!hideFinancials && (
          <>
            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center shadow-inner">
                  <DollarSign size={24} />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Value</p>
                  <h3 className="text-2xl font-black text-slate-900">₹{financials.totalValue.toLocaleString()}</h3>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-rose-50 text-rose-600 rounded-2xl flex items-center justify-center shadow-inner">
                  <CreditCard size={24} />
                </div>
                <div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pending Payment</p>
                  <h3 className="text-2xl font-black text-slate-900">₹{financials.totalPending.toLocaleString()}</h3>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Alerts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {delayedProjects.length > 0 && (
          <div className="bg-rose-50 border border-rose-100 rounded-3xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle className="text-rose-600" size={20} />
              <h3 className="text-xs font-black text-rose-900 uppercase tracking-widest">Delayed Projects Alert</h3>
            </div>
            <div className="space-y-3">
              {delayedProjects.slice(0, 3).map(p => (
                <div key={p.id} className="bg-white/50 p-3 rounded-xl border border-rose-200/50 flex justify-between items-center">
                  <div>
                    <p className="text-[11px] font-black text-slate-900 uppercase">{p.siteName}</p>
                    <p className="text-[9px] font-bold text-rose-600 mt-0.5">{p.remarks || 'Status: Delayed'}</p>
                  </div>
                  <span className="text-[9px] font-black bg-rose-100 text-rose-700 px-2 py-1 rounded-lg uppercase">
                    {p.projectStatus}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!hideFinancials && financials.totalPending > 0 && (
          <div className="bg-amber-50 border border-amber-100 rounded-3xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <CreditCard className="text-amber-600" size={20} />
              <h3 className="text-xs font-black text-amber-900 uppercase tracking-widest">High Pending Payments</h3>
            </div>
            <div className="space-y-3">
              {financials.pendingByProject.slice(0, 3).map(p => (
                <div key={p.name} className="bg-white/50 p-3 rounded-xl border border-amber-200/50 flex justify-between items-center">
                  <div>
                    <p className="text-[11px] font-black text-slate-900 uppercase">{p.name}</p>
                    <p className="text-[9px] font-bold text-amber-600 mt-0.5">₹{p.pending.toLocaleString()}</p>
                  </div>
                  <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-amber-500" 
                      style={{ width: `${Math.min(100, (p.pending / financials.totalPending) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Status Distribution */}
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6">Project Status Distribution</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name, value }) => `${name}: ${value}`}
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend verticalAlign="bottom" height={36}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Project Trends */}
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6">Project Count Trends</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 20, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="month" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#94a3b8' }}
                  allowDecimals={false}
                />
                <Tooltip />
                <Line 
                  type="monotone" 
                  dataKey="count" 
                  stroke="#3b82f6" 
                  strokeWidth={4} 
                  dot={{ r: 6, fill: '#3b82f6', strokeWidth: 2, stroke: '#fff' }}
                  activeDot={{ r: 8 }}
                >
                  <LabelList dataKey="count" position="top" style={{ fontSize: '10px', fontWeight: 700, fill: '#3b82f6' }} offset={10} />
                </Line>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Salesperson Performance */}
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6">Salesperson Performance</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salespersonData} layout="vertical" margin={{ right: 40, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" hide allowDecimals={false} />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }}
                  width={100}
                />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20}>
                  <LabelList dataKey="count" position="right" style={{ fontSize: '10px', fontWeight: 700, fill: '#3b82f6' }} offset={10} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Location Distribution */}
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6">Location-wise Projects</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={locationData} margin={{ top: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }}
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }} allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#10b981" radius={[4, 4, 0, 0]} barSize={30}>
                  <LabelList dataKey="count" position="top" style={{ fontSize: '10px', fontWeight: 700, fill: '#10b981' }} offset={10} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {!hideFinancials && (
          <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6">Pending Payment by Project</h3>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={financials.pendingByProject} layout="vertical" margin={{ right: 80, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" hide />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }}
                    width={100}
                  />
                  <Tooltip />
                  <Bar dataKey="pending" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={20}>
                    <LabelList 
                      dataKey="pending" 
                      position="right" 
                      formatter={(val: number) => `₹${val.toLocaleString()}`}
                      style={{ fontSize: '9px', fontWeight: 700, fill: '#ef4444' }} 
                      offset={10}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {!hideFinancials && (
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6">Top High Value Projects</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={financials.highValueProjects} margin={{ top: 20 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }}
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 700, fill: '#64748b' }} />
                <Tooltip />
                <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={40}>
                  <LabelList 
                    dataKey="value" 
                    position="top" 
                    formatter={(val: number) => `₹${val.toLocaleString()}`}
                    style={{ fontSize: '9px', fontWeight: 700, fill: '#8b5cf6' }} 
                    offset={10}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
