import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CheckCircle } from "lucide-react";

export default function LandingPage() {
  const features = [
    {
      title: "Auto Dependencies",
      description: "Automatically detects and installs required dependencies for your component",
    },
    {
      title: "Tool Detection",
      description: "Seamlessly integrates with Tailwind CSS, shadcn/ui, and other popular tools",
    },
    {
      title: "Zero Config",
      description: "No setup required. Start developing instantly with hot reload enabled",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-slate-900">
      <div className="container mx-auto px-4 py-16">
        {/* Hero Section */}
        <section className="text-center mb-16 space-y-6">
          <Badge variant="secondary" className="mb-2">
            New in Bun 1.2.3
          </Badge>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
            From Component to App in
            <span className="text-primary"> Seconds</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Start a complete dev server from a single React component. No config needed.
          </p>

          <div className="flex flex-wrap justify-center gap-4 pt-4">
            <Button size="lg" className="min-w-[140px]">
              Get Started
            </Button>
            <Button size="lg" variant="outline" className="min-w-[140px]">
              Documentation
            </Button>
          </div>
        </section>

        {/* Code Preview */}
        <Card className="bg-slate-900 p-6 mb-16">
          <div className="overflow-x-auto">
            <pre className="text-green-400 text-sm md:text-base">
              <code>
                $ bun create ./MyComponent.tsx
                <br />
                📦 Installing dependencies...
                <br />
                🔍 Detected Tailwind CSS
                <br />
                🎨 Detected shadcn/ui
                <br />✨ Dev server running at http://localhost:3000
              </code>
            </pre>
          </div>
        </Card>

        {/* Features Grid */}
        <section className="grid md:grid-cols-3 gap-8 mb-16">
          {features.map((feature, index) => (
            <Card key={index} className="p-6 hover:shadow-lg transition-shadow duration-200">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle className="h-5 w-5 text-primary shrink-0" />
                <h3 className="font-semibold text-lg">{feature.title}</h3>
              </div>
              <p className="text-muted-foreground">{feature.description}</p>
            </Card>
          ))}
        </section>

        {/* CTA Section */}
        <section className="text-center">
          <Card className="p-8 bg-primary/5 border-primary/10">
            <h2 className="text-2xl md:text-3xl font-bold mb-4">Ready to streamline your React development?</h2>
            <p className="text-muted-foreground mb-6">
              Get started with Bun's powerful component development workflow today.
            </p>
            <Button size="lg" className="min-w-[160px]">
              Install Bun
            </Button>
          </Card>
        </section>
      </div>
    </div>
  );
}
