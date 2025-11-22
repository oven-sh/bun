export default function LandingPage() {
  let copied = false;
  const handleCopy = () => {
    navigator.clipboard.writeText("bun create ./MyComponent.tsx");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-black text-white">
      <div className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-16">
          <h1 className="text-6xl font-bold mb-6">
            <span className="text-purple-400">bun create</span> for React
          </h1>
          <p className="text-xl text-gray-300 mb-8">Start a React dev server instantly from a single component file</p>

          <div className="bg-gray-800 p-4 rounded-lg flex items-center justify-between max-w-lg mx-auto mb-8">
            <code className="text-purple-400">bun create ./MyComponent.tsx</code>
            <button onClick={handleCopy} className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded transition">
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-8 mb-20">
          <div className="bg-gray-800 p-6 rounded-lg">
            <h3 className="text-xl font-semibold mb-4">Zero Config</h3>
            <p className="text-gray-300">Just write your React component and run. No setup needed.</p>
          </div>

          <div className="bg-gray-800 p-6 rounded-lg">
            <h3 className="text-xl font-semibold mb-4">Auto Dependencies</h3>
            <p className="text-gray-300">Automatically detects and installs required npm packages.</p>
          </div>

          <div className="bg-gray-800 p-6 rounded-lg">
            <h3 className="text-xl font-semibold mb-4">Tool Detection</h3>
            <p className="text-gray-300">Recognizes Tailwind, animations, and UI libraries automatically.</p>
          </div>
        </div>

        <div className="bg-gray-800 rounded-lg p-8 mb-20">
          <h2 className="text-3xl font-bold mb-6">How it Works</h2>
          <div className="space-y-4">
            <div className="flex items-start gap-4">
              <div className="bg-purple-600 rounded-full p-2 mt-1">1</div>
              <div>
                <h3 className="font-semibold mb-2">Create Component</h3>
                <p className="text-gray-300">Write your React component in a .tsx file</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="bg-purple-600 rounded-full p-2 mt-1">2</div>
              <div>
                <h3 className="font-semibold mb-2">Run Command</h3>
                <p className="text-gray-300">Execute bun create with your file path</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="bg-purple-600 rounded-full p-2 mt-1">3</div>
              <div>
                <h3 className="font-semibold mb-2">Start Developing</h3>
                <p className="text-gray-300">Dev server starts instantly with hot reload</p>
              </div>
            </div>
          </div>
        </div>

        <div className="text-center">
          <h2 className="text-3xl font-bold mb-6">Ready to Try?</h2>
          <div className="space-x-4">
            <a
              href="https://bun.com/docs"
              className="inline-block bg-purple-600 hover:bg-purple-700 px-6 py-3 rounded-lg transition"
            >
              Read Docs
            </a>
            <a
              href="https://github.com/oven-sh/bun"
              className="inline-block bg-gray-700 hover:bg-gray-600 px-6 py-3 rounded-lg transition"
            >
              GitHub →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
