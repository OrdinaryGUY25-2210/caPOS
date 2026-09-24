import React from 'react';
import { Card } from '@/components/ui/Card';

interface ColumnMapperProps {
  columns: string[];
  mappings: Record<string, string>;
  onMappingChange: (column: string, mapping: string) => void;
  /** PRIORITY 14: target fields now depend on the selected import type
   *  (products/customers/suppliers each have different real columns) —
   *  the old hardcoded name/email/phone list only fit one case. Falls
   *  back to that original list if the caller doesn't pass one, so
   *  nothing else that might use this component breaks. */
  targetFields?: { value: string; label: string; required?: boolean }[];
}

const DEFAULT_TARGET_FIELDS = [
  { value: 'name', label: 'Name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
];

export function ColumnMapper({ columns, mappings, onMappingChange, targetFields = DEFAULT_TARGET_FIELDS }: ColumnMapperProps) {
  return (
    <Card className="p-4">
      <h3 className="font-semibold mb-4">Map Columns</h3>
      <div className="space-y-3">
        {columns.map((col) => (
          <div key={col} className="flex items-center gap-2">
            <label className="font-medium text-sm min-w-32">{col}</label>
            <select
              value={mappings[col] || ''}
              onChange={(e) => onMappingChange(col, e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 rounded"
            >
              <option value="">-- Abaikan kolom ini --</option>
              {targetFields.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                  {f.required ? ' *' : ''}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-500 mt-3">* Wajib diisi</p>
    </Card>
  );
}
