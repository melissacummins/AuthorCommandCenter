import React, { useRef } from 'react';
import { Download, Upload, AlertTriangle, RefreshCw } from 'lucide-react';
import { AppDataBackup, ProfitCategory, UserUIPreferences } from '../types';
import FirebaseImport from './FirebaseImport';
import CategoriesSettings from './CategoriesSettings';
import TabVisibilitySettings from './TabVisibilitySettings';

interface SettingsProps {
  onBackup: () => AppDataBackup;
  onRestore: (data: AppDataBackup) => void;
  onClear: () => void;
  categories: ProfitCategory[];
  onUpdateCategories: (next: ProfitCategory[]) => void;
  uiPrefs: UserUIPreferences;
  onUpdateUIPrefs: (next: UserUIPreferences) => void;
}

export const Settings: React.FC<SettingsProps> = ({
  onBackup,
  onRestore,
  onClear,
  categories,
  onUpdateCategories,
  uiPrefs,
  onUpdateUIPrefs,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDownload = () => {
    const data = onBackup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `profittrack_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const data = JSON.parse(text) as AppDataBackup;
        
        // Basic validation
        if (!data.dailyRecords || !data.orderSources) {
          throw new Error("Invalid backup file format");
        }
        
        if (confirm(`Found ${data.dailyRecords.length} records and ${data.orderSources.length} sources. Restore and overwrite current data?`)) {
          onRestore(data);
          alert('Data restored successfully!');
        }
      } catch (err) {
        alert('Failed to parse backup file. Please ensure it is a valid JSON file exported from ProfitTrack.');
        console.error(err);
      }
    };
    reader.readAsText(file);
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClear = () => {
    if (confirm("WARNING: This will permanently delete ALL data. This cannot be undone. Are you sure?")) {
      if (confirm("Double check: Are you absolutely sure?")) {
        onClear();
      }
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-fade-in">
      <CategoriesSettings
        categories={categories}
        onUpdate={onUpdateCategories}
      />

      <TabVisibilitySettings uiPrefs={uiPrefs} onUpdate={onUpdateUIPrefs} />

      <FirebaseImport />

      <div className="bg-surface p-8 rounded-card shadow-sm border border-edge-soft">
        <h2 className="text-xl font-bold text-content mb-6 flex items-center">
          <RefreshCw className="w-6 h-6 mr-2 text-content" />
          Data Management
        </h2>

        <div className="space-y-8">
          {/* Backup Section */}
          <div className="pb-8 border-b border-edge-soft">
            <h3 className="text-lg font-medium text-content mb-2">Backup Data</h3>
            <p className="text-sm text-content-secondary mb-4">
              Download a complete copy of your financial records, notes, order configurations, and history to your computer.
            </p>
            <button 
              onClick={handleDownload}
              className="flex items-center px-4 py-2 bg-brand-50 text-brand-700 border border-brand-200 rounded-control hover:bg-brand-100 transition-colors font-medium"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Backup (.json)
            </button>
          </div>

          {/* Restore Section */}
          <div className="pb-8 border-b border-edge-soft">
            <h3 className="text-lg font-medium text-content mb-2">Restore Data</h3>
            <p className="text-sm text-content-secondary mb-4">
              Import a previously saved backup file. <span className="text-red-600 font-medium">Warning: This will overwrite your current data.</span>
            </p>
            <div className="flex items-center">
               <input 
                  type="file" 
                  ref={fileInputRef}
                  accept=".json"
                  onChange={handleFileChange}
                  className="hidden" 
               />
               <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center px-4 py-2 bg-surface text-content border border-edge-strong rounded-control hover:bg-surface-hover transition-colors font-medium shadow-sm"
               >
                  <Upload className="w-4 h-4 mr-2" />
                  Select File to Restore
               </button>
            </div>
          </div>

          {/* Danger Zone */}
          <div>
            <h3 className="text-lg font-medium text-red-600 mb-2 flex items-center">
              <AlertTriangle className="w-5 h-5 mr-2" />
              Danger Zone
            </h3>
            <p className="text-sm text-content-secondary mb-4">
              Permanently delete all application data.
            </p>
            <button 
              onClick={handleClear}
              className="px-4 py-2 bg-red-50 text-red-700 border border-red-200 rounded-control hover:bg-red-100 transition-colors font-medium text-sm"
            >
              Clear All Data
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};