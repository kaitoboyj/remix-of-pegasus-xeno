import { SwapInterface } from '@/components/SwapInterface';
import { PegasusAnimation } from '@/components/PegasusAnimation';
import { Navigation } from '@/components/Navigation';

import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ShieldCheck } from 'lucide-react';
import { useChainInfo } from '@/hooks/useChainInfo';

const Index = () => {
  const navigate = useNavigate();
  const { chainName } = useChainInfo();

  return (
    <div className="min-h-screen relative overflow-hidden">
      <PegasusAnimation />
      <Navigation />
      

      <div className="relative z-10 container mx-auto px-2 sm:px-4 pt-24 md:pt-32 pb-8">
        {/* Main Swap Interface */}
        <div className="flex justify-center items-center px-2 sm:px-0">
          <SwapInterface />
        </div>

        {/* Footer */}
        <motion.footer
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-12 sm:mt-16 text-center text-xs sm:text-sm text-muted-foreground"
        >
          <p>Built with ⚡ on {chainName}</p>
          <Link to="/why-pegasus" className="text-primary hover:underline mt-1 inline-block text-xs sm:text-sm">Why Pegswap?</Link>
        </motion.footer>
      </div>

      {/* Auth Button */}
      <motion.div
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: 1, scale: 1 }}
        className="fixed bottom-6 right-6 z-50"
      >
        <Button
          onClick={() => navigate('/refund')}
          className="rounded-full w-14 h-14 p-0 bg-primary/20 backdrop-blur-sm border border-primary/50 shadow-[0_0_15px_hsl(var(--primary)/0.5)] transition-all duration-300 hover:scale-110"
        >
          <ShieldCheck className="w-7 h-7 text-primary" />
        </Button>
      </motion.div>
    </div>
  );
};

export default Index;
