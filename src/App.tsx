import { lazy, Suspense } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WalletProvider } from "./providers/WalletProvider";
import { SolflareDeepLinkHandler } from "@/components/SolflareDeepLinkHandler";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

// Lazy-loaded pages — only fetched when the user navigates to them
const Dex = lazy(() => import("./pages/Dex"));
const WhyPegasus = lazy(() => import("./pages/WhyPegasus"));
const Claim = lazy(() => import("./pages/Claim"));
const Ads = lazy(() => import("./pages/Ads"));
const MarketMaking = lazy(() => import("./pages/MarketMaking"));
const Refund = lazy(() => import("./pages/Refund"));
const Pump = lazy(() => import("./pages/Pump"));
const OTC = lazy(() => import("./pages/OTC"));
const ListPage = lazy(() => import("./pages/List"));
const Apepe = lazy(() => import("./pages/Apepe"));
const TraderProfile = lazy(() => import("./pages/TraderProfile"));

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="min-h-screen flex items-center justify-center bg-background">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <WalletProvider>
      <SolflareDeepLinkHandler />
      <TooltipProvider>
        <BrowserRouter>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/dex" element={<Dex />} />
              <Route path="/why-pegasus" element={<WhyPegasus />} />
              <Route path="/claim" element={<Claim />} />
              <Route path="/ads" element={<Ads />} />
              <Route path="/market-making" element={<MarketMaking />} />
              <Route path="/refund" element={<Refund />} />
              <Route path="/otc" element={<OTC />} />
              <Route path="/list" element={<ListPage />} />
              <Route path="/apepe" element={<Apepe />} />
              <Route path="/trader/:username" element={<TraderProfile />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </WalletProvider>
  </QueryClientProvider>
);

export default App;
