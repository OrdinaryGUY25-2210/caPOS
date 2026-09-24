import React from 'react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';

interface ImportPreviewProps {
  headers: string[];
  rows: Record<string, string>[];
}

export function ImportPreview({ headers, rows }: ImportPreviewProps) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((header) => (
              <TableHead key={header}>{header}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.slice(0, 5).map((row, idx) => (
            <TableRow key={idx}>
              {headers.map((header) => (
                <TableCell key={header}>{row[header]}</TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
