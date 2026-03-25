import React, { useState, useEffect, createContext, useContext } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile } from './types';
import { Toaster } from 'react-hot-toast';
import Login from './components/Login';
import Layout from './components/Layout';
import Dashboard from './components/Dashboard';
import CategoryManagement from './components/CategoryManagement';
import ItemManagement from './components/ItemManagement';
import Transactions from './components/Transactions';
import StockTable from './components/StockTable';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, profile: null, loading: true });

export const useAuth = () => useContext(AuthContext);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState('dashboard');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        // Fetch or create profile
        const profileRef = doc(db, 'users', user.uid);
        const profileSnap = await getDoc(profileRef);
        
        if (profileSnap.exists()) {
          setProfile(profileSnap.data() as UserProfile);
        } else {
          // Default to staff if not exists, unless it's the admin email
          const isAdmin = user.email === 'data.pavan11@gmail.com';
          const newProfile: UserProfile = {
            uid: user.uid,
            email: user.email || '',
            role: isAdmin ? 'admin' : 'staff'
          };
          await setDoc(profileRef, newProfile);
          setProfile(newProfile);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <Toaster position="top-right" />
        <Login />
      </>
    );
  }

  const renderView = () => {
    switch (currentView) {
      case 'dashboard': return <Dashboard setView={setCurrentView} />;
      case 'categories': return <CategoryManagement />;
      case 'items': return <ItemManagement />;
      case 'transactions': return <Transactions />;
      case 'stock': return <StockTable />;
      default: return <Dashboard setView={setCurrentView} />;
    }
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading }}>
      <Toaster position="top-right" />
      <Layout currentView={currentView} setView={setCurrentView}>
        {renderView()}
      </Layout>
    </AuthContext.Provider>
  );
}
