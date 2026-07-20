import React, { useState } from 'react';
import { Eye, EyeOff, Plus, Trash2, ChevronUp, ChevronDown, Tag } from 'lucide-react';
import type { ProfitCategory, CategoryType } from '../types';

interface CategoriesSettingsProps {
  categories: ProfitCategory[];
  onUpdate: (next: ProfitCategory[]) => void;
}

export default function CategoriesSettings({ categories, onUpdate }: CategoriesSettingsProps) {
  return (
    <div className="bg-surface p-6 rounded-card shadow-sm border border-edge-soft">
      <h3 className="text-lg font-semibold text-content mb-1 flex items-center gap-2">
        <Tag className="w-5 h-5 text-brand-500" />
        Ad & Revenue Categories
      </h3>
      <p className="text-sm text-content-secondary mb-6">
        Rename, hide, reorder, or add categories. Hiding a category keeps its
        historical data — it just disappears from data entry and reports.
        Built-in categories can't be deleted (only hidden); custom ones can.
      </p>

      <CategorySection
        title="Ad Spend"
        type="ad"
        categories={categories}
        onUpdate={onUpdate}
      />

      <div className="my-8 border-t border-edge-soft" />

      <CategorySection
        title="Revenue"
        type="revenue"
        categories={categories}
        onUpdate={onUpdate}
      />
    </div>
  );
}

function CategorySection({
  title,
  type,
  categories,
  onUpdate,
}: {
  title: string;
  type: CategoryType;
  categories: ProfitCategory[];
  onUpdate: (next: ProfitCategory[]) => void;
}) {
  const inThisType = categories
    .filter((c) => c.type === type)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const replaceCategory = (updated: ProfitCategory) => {
    onUpdate(categories.map((c) => (c.id === updated.id ? updated : c)));
  };

  const removeCategory = (id: string) => {
    onUpdate(categories.filter((c) => c.id !== id));
  };

  const move = (id: string, direction: -1 | 1) => {
    const idx = inThisType.findIndex((c) => c.id === id);
    const swapWith = inThisType[idx + direction];
    if (!swapWith) return;
    const a = inThisType[idx];
    const aOrder = a.sortOrder;
    const bOrder = swapWith.sortOrder;
    const next = categories.map((c) => {
      if (c.id === a.id) return { ...c, sortOrder: bOrder };
      if (c.id === swapWith.id) return { ...c, sortOrder: aOrder };
      return c;
    });
    onUpdate(next);
  };

  const handleAdd = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const maxOrder = inThisType.reduce((m, c) => Math.max(m, c.sortOrder), 0);
    const newCat: ProfitCategory = {
      id: crypto.randomUUID(),
      name: trimmed,
      type,
      legacyColumn: null,
      sortOrder: maxOrder + 1,
      isVisible: true,
      isCustom: true,
    };
    onUpdate([...categories, newCat]);
  };

  return (
    <div>
      <h4 className="text-sm font-bold text-content-secondary uppercase tracking-wider mb-3">
        {title}
      </h4>
      <div className="space-y-2">
        {inThisType.map((c, idx) => (
          <CategoryRow
            key={c.id}
            category={c}
            canMoveUp={idx > 0}
            canMoveDown={idx < inThisType.length - 1}
            onChange={replaceCategory}
            onRemove={() => removeCategory(c.id)}
            onMoveUp={() => move(c.id, -1)}
            onMoveDown={() => move(c.id, 1)}
          />
        ))}
      </div>
      <AddCategoryForm onAdd={handleAdd} />
    </div>
  );
}

interface CategoryRowProps {
  category: ProfitCategory;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (c: ProfitCategory) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

const CategoryRow: React.FC<CategoryRowProps> = ({
  category,
  canMoveUp,
  canMoveDown,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}) => {
  const handleDelete = () => {
    if (!category.isCustom) return;
    if (
      confirm(
        `Delete "${category.name}"? Any custom amounts entered for this category will be hidden but not removed from the database.`,
      )
    ) {
      onRemove();
    }
  };

  return (
    <div
      className={`flex items-center gap-2 p-3 rounded-control border ${
        category.isVisible
          ? 'bg-surface border-edge'
          : 'bg-surface-hover border-edge opacity-70'
      }`}
    >
      <div className="flex flex-col">
        <button
          onClick={onMoveUp}
          disabled={!canMoveUp}
          className="p-0.5 text-content-muted hover:text-content disabled:opacity-20 disabled:cursor-default"
          title="Move up"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onMoveDown}
          disabled={!canMoveDown}
          className="p-0.5 text-content-muted hover:text-content disabled:opacity-20 disabled:cursor-default"
          title="Move down"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      <input
        type="text"
        value={category.name}
        onChange={(e) => onChange({ ...category, name: e.target.value })}
        className="flex-1 px-3 py-1.5 border border-edge rounded text-sm focus:ring-2 focus:ring-brand-400 focus:border-transparent"
      />

      {!category.isCustom && (
        <span className="text-[10px] uppercase tracking-wider font-semibold text-content-muted bg-surface-sunken px-2 py-0.5 rounded">
          Built-in
        </span>
      )}

      <button
        onClick={() => onChange({ ...category, isVisible: !category.isVisible })}
        className={`p-1.5 rounded ${
          category.isVisible
            ? 'text-emerald-600 hover:bg-emerald-50'
            : 'text-content-muted hover:bg-surface-sunken'
        }`}
        title={category.isVisible ? 'Visible — click to hide' : 'Hidden — click to show'}
      >
        {category.isVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
      </button>

      {category.isCustom ? (
        <button
          onClick={handleDelete}
          className="p-1.5 text-content-muted hover:text-red-600 hover:bg-red-50 rounded"
          title="Delete custom category"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      ) : (
        <span className="w-7" />
      )}
    </div>
  );
};

function AddCategoryForm({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState('');
  const submit = () => {
    if (!name.trim()) return;
    onAdd(name);
    setName('');
  };
  return (
    <div className="flex items-center gap-2 mt-3 pt-3 border-t border-dashed border-edge">
      <input
        type="text"
        placeholder="Add a custom category…"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        className="flex-1 px-3 py-1.5 border border-edge rounded text-sm placeholder-slate-400 focus:ring-2 focus:ring-brand-400 focus:border-transparent"
      />
      <button
        onClick={submit}
        disabled={!name.trim()}
        className="flex items-center gap-1 px-3 py-1.5 bg-brand-600 text-brand-fg text-sm font-medium rounded hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Plus className="w-3.5 h-3.5" />
        Add
      </button>
    </div>
  );
}
