// High-performance virtualized table component for large datasets
// Uses react-window for efficient rendering and memoization for optimal performance

'use client';

import { memo, useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { FixedSizeList as List } from 'react-window';

export interface Column<T> {
  id: string;
  header: string;
  accessor: (row: T) => React.ReactNode;
  width?: number;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
}

export interface TableProps<T> {
  data: T[];
  columns: Column<T>[];
  rowHeight?: number;
  maxHeight?: number;
  onRowClick?: (row: T) => void;
  keyExtractor: (row: T) => string;
  virtualized?: boolean;
  emptyState?: React.ReactNode;
}

// Memoized table row component for performance
const TableRow = memo(function TableRow<T>({
  row,
  columns,
  onClick,
  style,
}: {
  row: T;
  columns: Column<T>[];
  onClick?: (row: T) => void;
  style?: React.CSSProperties;
}) {
  const handleClick = useCallback(() => {
    onClick?.(row);
  }, [row, onClick]);

  return (
    <tr
      onClick={handleClick}
      style={{
        ...style,
        cursor: onClick ? 'pointer' : 'default',
        display: style ? 'flex' : undefined,
        alignItems: style ? 'center' : undefined,
      }}
    >
      {columns.map((col) => (
        <td
          key={col.id}
          style={{
            textAlign: col.align || 'left',
            width: style ? col.width || 'auto' : undefined,
            flex: style && !col.width ? 1 : undefined,
          }}
        >
          {col.accessor(row)}
        </td>
      ))}
    </tr>
  );
});

// Virtual row renderer for react-window
function VirtualRow<T>({
  index,
  style,
  data,
}: {
  index: number;
  style: React.CSSProperties;
  data: {
    rows: T[];
    columns: Column<T>[];
    onRowClick?: (row: T) => void;
  };
}) {
  const { rows, columns, onRowClick } = data;
  const row = rows[index];

  return <TableRow row={row} columns={columns} onClick={onRowClick} style={style} />;
}

export function Table<T>({
  data,
  columns,
  rowHeight = 48,
  maxHeight = 600,
  onRowClick,
  keyExtractor,
  virtualized = true,
  emptyState,
}: TableProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Track container width for responsive columns
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0].contentRect.width;
      setContainerWidth(width);
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Memoize the item data to prevent unnecessary re-renders
  const itemData = useMemo(
    () => ({
      rows: data,
      columns,
      onRowClick,
    }),
    [data, columns, onRowClick]
  );

  // Calculate total height for virtualization
  const listHeight = useMemo(() => {
    const calculatedHeight = Math.min(data.length * rowHeight, maxHeight);
    return calculatedHeight;
  }, [data.length, rowHeight, maxHeight]);

  if (data.length === 0 && emptyState) {
    return <div>{emptyState}</div>;
  }

  // Use virtualized rendering for large datasets (>50 rows)
  const shouldVirtualize = virtualized && data.length > 50;

  return (
    <div ref={containerRef} style={{ width: '100%', overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.id}
                style={{
                  textAlign: col.align || 'left',
                  width: col.width || undefined,
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
      </table>

      {shouldVirtualize ? (
        <List
          height={listHeight}
          itemCount={data.length}
          itemSize={rowHeight}
          width="100%"
          itemData={itemData}
          overscanCount={5}
        >
          {VirtualRow}
        </List>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {data.map((row) => (
              <TableRow
                key={keyExtractor(row)}
                row={row}
                columns={columns}
                onClick={onRowClick}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
