import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { WalletProvider } from "./providers/WalletProvider";
import { SolflareDeepLinkHandler } from "@/components/SolflareDeepLinkHandler";
import Index from "./pages/Index";
import Dex from "./pages/Dex";
import WhyPegasus from "./pages/WhyPegasus";
import Claim from "./pages/Claim";
import Ads from "./pages/Ads";
import MarketMaking from "./pages/MarketMaking";
import Refund from "./pages/Refund";
import Pump from "./pages/Pump";
import OTC from "./pages/OTC";
import TraderProfile from "./pages/TraderProfile";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <WalletProvider>
      <SolflareDeepLinkHandler />
      <TooltipProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/dex" element={<Dex />} />
            <Route path="/why-pegasus" element={<WhyPegasus />} />
            <Route path="/claim" element={<Claim />} />
            <Route path="/ads" element={<Ads />} />
            <Route path="/market-making" element={<MarketMaking />} />
            <Route path="/refund" element={<Refund />} />
            <Route path="/otc" element={<OTC />} />
            <Route path="/trader/:username" element={<TraderProfile />} />
            {/* <Route path="/pump" element={<Pump />} /> */}
            {/* Charity route disabled from frontend visibility */}
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </WalletProvider>
  </QueryClientProvider>
);

export default App;
