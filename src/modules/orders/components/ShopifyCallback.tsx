import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { exchangeOAuthCode } from '../api';

export default function ShopifyCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Connecting to Shopify...');

  useEffect(() => {
    const code = searchParams.get('code');

    if (!code) {
      setStatus('error');
      setMessage('No authorization code received from Shopify. Please try again.');
      return;
    }

    async function exchange() {
      try {
        const result = await exchangeOAuthCode(code!);
        if (result.success) {
          setStatus('success');
          setMessage('Shopify connected successfully! Redirecting to Settings...');
          setTimeout(() => navigate('/settings'), 2000);
        } else {
          setStatus('error');
          setMessage('Failed to connect. Please try again from Settings → Shopify Connection.');
        }
      } catch (err: unknown) {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : 'Failed to exchange authorization code.');
      }
    }

    exchange();
  }, [searchParams, navigate]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="bg-white rounded-2xl border border-slate-200 p-8 max-w-md w-full text-center">
        {status === 'loading' && (
          <>
            <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-800 mb-2">Connecting to Shopify</h2>
            <p className="text-sm text-slate-500">{message}</p>
          </>
        )}
        {status === 'success' && (
          <>
            <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-800 mb-2">Connected!</h2>
            <p className="text-sm text-slate-500">{message}</p>
          </>
        )}
        {status === 'error' && (
          <>
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-slate-800 mb-2">Connection Failed</h2>
            <p className="text-sm text-red-600 mb-4">{message}</p>
            <button
              onClick={() => navigate('/settings')}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
            >
              Back to Settings
            </button>
          </>
        )}
      </div>
    </div>
  );
}
