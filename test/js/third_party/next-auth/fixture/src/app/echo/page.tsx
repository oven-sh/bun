'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function EchoPage() {
  const [input, setInput] = useState('');
  const [response, setResponse] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const res = await fetch('/api/echo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: input }),
      });
      
      const data = await res.json();
      setResponse(data);
    } catch (error) {
      setResponse({ error: 'Failed to fetch' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-8">
      <main className="w-full max-w-md">
        <h1 className="text-2xl font-bold mb-6">Echo API Demo</h1>
        
        <form onSubmit={handleSubmit} className="mb-6">
          <div className="flex flex-col gap-4">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Enter a message"
              className="p-3 border rounded-md"
            />
            <button 
              type="submit" 
              disabled={loading}
              className="p-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Sending...' : 'Send'}
            </button>
          </div>
        </form>

        {response && (
          <div className="w-full p-4 border rounded-md mb-6">
            <h2 className="text-lg font-bold mb-2">Response:</h2>
            <pre className="bg-gray-100 p-3 rounded overflow-auto">
              {JSON.stringify(response, null, 2)}
            </pre>
          </div>
        )}

        <Link
          href="/"
          className="text-indigo-600 hover:underline"
        >
          ← Back to home
        </Link>
      </main>
    </div>
  );
}
