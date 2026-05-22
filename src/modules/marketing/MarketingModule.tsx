import { useState } from 'react';
import { Megaphone, Share2, Tag, Mail } from 'lucide-react';
import AdsTab from './components/AdsTab';
import SocialMediaTab from './components/SocialMediaTab';
import PromotionsTab from './components/PromotionsTab';
import NewslettersTab from './components/NewslettersTab';

type MainTab = 'ads' | 'social-media' | 'promotions' | 'newsletters';

export default function MarketingModule() {
  const [mainTab, setMainTab] = useState<MainTab>('ads');

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap gap-1 bg-slate-100 rounded-lg p-1">
          <TabButton active={mainTab === 'ads'} onClick={() => setMainTab('ads')}>
            <Megaphone className="w-4 h-4" /> Ads
          </TabButton>
          <TabButton active={mainTab === 'promotions'} onClick={() => setMainTab('promotions')}>
            <Tag className="w-4 h-4" /> Promotions
          </TabButton>
          <TabButton active={mainTab === 'newsletters'} onClick={() => setMainTab('newsletters')}>
            <Mail className="w-4 h-4" /> Newsletters
          </TabButton>
          <TabButton active={mainTab === 'social-media'} onClick={() => setMainTab('social-media')}>
            <Share2 className="w-4 h-4" /> Social Media
          </TabButton>
        </div>
      </div>

      {mainTab === 'ads' && <AdsTab />}
      {mainTab === 'promotions' && <PromotionsTab />}
      {mainTab === 'newsletters' && <NewslettersTab />}
      {mainTab === 'social-media' && <SocialMediaTab />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  );
}
