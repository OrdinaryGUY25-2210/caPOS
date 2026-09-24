import React from 'react';

type ImportType = 'products' | 'customers' | 'suppliers' | 'recipes';

interface ImportTypeSelectorProps {
  selected: ImportType;
  onChange: (type: ImportType) => void;
}

export function ImportTypeSelector({ selected, onChange }: ImportTypeSelectorProps) {
  const types: { value: ImportType; label: string }[] = [
    { value: 'products', label: 'Products' },
    { value: 'customers', label: 'Customers' },
    { value: 'suppliers', label: 'Suppliers' },
    { value: 'recipes', label: 'Recipes' },
  ];

  return (
    <div className="space-y-2">
      {types.map((type) => (
        <label key={type.value} className="flex items-center gap-2">
          <input
            type="radio"
            name="import-type"
            value={type.value}
            checked={selected === type.value}
            onChange={(e) => onChange(e.target.value as ImportType)}
            className="w-4 h-4"
          />
          <span>{type.label}</span>
        </label>
      ))}
    </div>
  );
}
