import React from "react";
import { createRoot } from "react-dom/client";
import classNames from "classnames";
import "./styles.css";

import Hero from "./components/Hero";
import Features from "./components/Features";
import Footer from "./components/Footer";

function App() {
  return (
    <div className={classNames("app")}>
      <main className="container">
        <Hero />
        <Features />
      </main>
      <Footer />
    </div>
  );
}

export default App;
