import "./styles.css";

import Features from "./components/Features";
import Footer from "./components/Footer";
import Hero from "./components/Hero";

function App() {
  return (
    <div className="app">
      <main className="container">
        <Hero />
        <Features />
      </main>
      <Footer />
    </div>
  );
}

export default App;
