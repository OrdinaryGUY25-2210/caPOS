import React from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

interface ImportResultProps {
  successful: number;
  failed: number;
  errors?: { row: number; message: string }[];
}

export function ImportResult({ successful, failed, errors }: ImportResultProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <p className="text-gray-600 text-sm">Successful</p>
          <p className="text-3xl font-bold text-green-600">{successful}</p>
        </Card>
        <Card className="p-4">
          <p className="text-gray-600 text-sm">Failed</p>
          <p className="text-3xl font-bold text-red-600">{failed}</p>
        </Card>
      </div>
      {errors && errors.length > 0 && (
        <Card className="p-4">
          <h4 className="font-semibold mb-2">Errors</h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {errors.map((error, idx) => (
              <div key={idx} className="text-sm flex gap-2">
                <Badge variant="danger">Row {error.row}</Badge>
                <span>{error.message}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
