import React, { useState } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider 
} from 'firebase/auth';
import { auth } from '../firebase';
import { toast } from 'react-hot-toast';
import { LogIn, UserPlus, Package, Chrome, TrendingUp } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showSecretLogin, setShowSecretLogin] = useState(false);
  const [secretCode, setSecretCode] = useState('');
  const [loginType, setLoginType] = useState<'STAFF' | 'MANAGEMENT'>('STAFF');

  const handleSecretLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const validCodes = {
      'STAFF': '202603',
      'MANAGEMENT': '888888'
    };

    if (secretCode !== validCodes[loginType]) {
      toast.error('Invalid Secret Code');
      return;
    }

    setLoading(true);
    try {
      // Use specific accounts for each role
      const email = loginType === 'MANAGEMENT' ? 'admin@inventorypro.app' : 'general@inventorypro.app';
      const password = loginType === 'MANAGEMENT' ? 'admin202603' : 'password202603';
      
      try {
        await signInWithEmailAndPassword(auth, email, password);
        toast.success(`Welcome ${loginType === 'MANAGEMENT' ? 'Manager' : ''}!`);
      } catch (error: any) {
        if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
          // If user doesn't exist, create it
          await createUserWithEmailAndPassword(auth, email, password);
          toast.success(`${loginType} account created and logged in!`);
        } else {
          throw error;
        }
      }
    } catch (error: any) {
      if (error.code === 'auth/operation-not-allowed') {
        toast.error('Email/Password login is not enabled in Firebase Console. Please enable it to use the Secret Code login.');
      } else {
        toast.error(error.message || 'Secret Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      toast.success('Welcome!');
    } catch (error: any) {
      toast.error(error.message || 'Google Sign-In failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
        toast.success('Welcome back!');
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
        toast.success('Account created successfully!');
      }
    } catch (error: any) {
      if (error.code === 'auth/operation-not-allowed') {
        toast.error('Email/Password login is not enabled in Firebase Console. Please enable it or use Google Login.');
      } else {
        toast.error(error.message || 'Authentication failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-blue-600 p-3 rounded-xl mb-4">
            <Package className="text-white w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Bharat Natural Elements</h1>
          <p className="text-slate-500">Manage your stock with ease</p>
        </div>

        {showSecretLogin ? (
          <form onSubmit={handleSecretLogin} className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="text-center mb-6">
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                {loginType === 'MANAGEMENT' ? 'Management Access' : 'Staff Quick Access'}
              </h3>
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">
                {loginType === 'MANAGEMENT' ? 'Enter Management PIN' : 'Enter Staff PIN'}
              </p>
            </div>
            <div>
              <input
                type="password"
                required
                value={secretCode}
                onChange={(e) => setSecretCode(e.target.value)}
                className={`w-full px-4 py-3 border rounded-lg focus:ring-2 outline-none transition-all text-center text-2xl tracking-[0.5em] font-bold ${
                  loginType === 'MANAGEMENT' ? 'border-indigo-200 focus:ring-indigo-500' : 'border-slate-200 focus:ring-blue-500'
                }`}
                placeholder="••••••"
                maxLength={6}
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading || secretCode.length < 6}
              className={`w-full text-white font-semibold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg ${
                loginType === 'MANAGEMENT' ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-600/20' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/20'
              }`}
            >
              {loading ? (
                <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              ) : (
                <>
                  <LogIn size={20} />
                  Access Dashboard
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowSecretLogin(false)}
              className="w-full text-sm text-slate-500 hover:text-slate-700 font-medium py-2"
            >
              Back to standard login
            </button>
          </form>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              placeholder="admin@example.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : isLogin ? (
              <>
                <LogIn size={20} />
                Sign In
              </>
            ) : (
              <>
                <UserPlus size={20} />
                Create Account
              </>
            )}
          </button>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-slate-500 uppercase tracking-wider font-semibold text-[10px]">Or continue with</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold py-2 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Chrome size={20} className="text-blue-600" />
            Google Account
          </button>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-2 bg-white text-slate-500 uppercase tracking-wider font-semibold text-[10px]">Quick Access</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => { setLoginType('STAFF'); setShowSecretLogin(true); }}
              disabled={loading}
              className="bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3 rounded-xl transition-all flex flex-col items-center justify-center gap-1 disabled:opacity-50 shadow-lg shadow-slate-900/20"
            >
              <Package size={20} className="text-blue-400" />
              <span className="text-[10px] uppercase tracking-widest font-black">Staff</span>
            </button>
            <button
              type="button"
              onClick={() => { setLoginType('MANAGEMENT'); setShowSecretLogin(true); }}
              disabled={loading}
              className="bg-indigo-900 hover:bg-indigo-800 text-white font-semibold py-3 rounded-xl transition-all flex flex-col items-center justify-center gap-1 disabled:opacity-50 shadow-lg shadow-indigo-900/20"
            >
              <TrendingUp size={20} className="text-indigo-400" />
              <span className="text-[10px] uppercase tracking-widest font-black">Management</span>
            </button>
          </div>
        </form>
      </>
    )}

        <div className="mt-6 text-center">
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
