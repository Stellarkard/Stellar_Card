/**
 * Performance optimization utilities for large transaction tables
 * Part 1: Core virtualization and pagination hooks
 * Implements efficient rendering strategies for large datasets
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';

export interface PaginationConfig {
  page: number;
  pageSize: number;
  total: number;
}

export interface VirtualizationConfig {
  itemHeight: number;
  containerHeight: number;
  overscan?: number;
}

export interface SortConfig<T> {
  key: keyof T | null;
  direction: 'asc' | 'desc';
}

/**
 * usePagination hook - manages pagination state for large datasets
 * Reduces DOM nodes by only rendering current page
 */
export function usePagination<T>(data: T[], initialPageSize = 50) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const paginatedData = useMemo(() => {
    const start = page * pageSize;
    const end = start + pageSize;
    return data.slice(start, end);
  }, [data, page, pageSize]);

  const totalPages = Math.ceil(data.length / pageSize);

  const nextPage = useCallback(() => {
    setPage((p) => Math.min(p + 1, totalPages - 1));
  }, [totalPages]);

  const previousPage = useCallback(() => {
    setPage((p) => Math.max(p - 1, 0));
  }, []);

  const goToPage = useCallback((targetPage: number) => {
    setPage(Math.max(0, Math.min(targetPage, totalPages - 1)));
  }, [totalPages]);

  const changePageSize = useCallback((newSize: number) => {
    setPageSize(newSize);
    setPage(0);
  }, []);

  return {
    paginatedData,
    page,
    pageSize,
    totalPages,
    total: data.length,
    nextPage,
    previousPage,
    goToPage,
    changePageSize,
    hasNextPage: page < totalPages - 1,
    hasPreviousPage: page > 0,
  };
}

/**
 * useVirtualization hook - implements virtual scrolling
 * Only renders visible rows + overscan for smooth scrolling
 */
export function useVirtualization<T>(
  data: T[],
  config: VirtualizationConfig
) {
  const { itemHeight, containerHeight, overscan = 3 } = config;
  const [scrollTop, setScrollTop] = useState(0);

  const visibleRange = useMemo(() => {
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end = Math.min(data.length, start + visibleCount + 2 * overscan);
    
    return { start, end };
  }, [scrollTop, itemHeight, containerHeight, data.length, overscan]);

  const virtualData = useMemo(() => {
    return data.slice(visibleRange.start, visibleRange.end).map((item, index) => ({
      item,
      index: visibleRange.start + index,
      offsetTop: (visibleRange.start + index) * itemHeight,
    }));
  }, [data, visibleRange, itemHeight]);

  const totalHeight = data.length * itemHeight;

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  return {
    virtualData,
    totalHeight,
    handleScroll,
    visibleRange,
  };
}

/**
 * useTableSort hook - manages sorting state for table columns
 * Optimized with useMemo to prevent unnecessary re-renders
 */
export function useTableSort<T>(data: T[], initialKey?: keyof T) {
  const [sortConfig, setSortConfig] = useState<SortConfig<T>>({
    key: initialKey || null,
    direction: 'asc',
  });

  const sortedData = useMemo(() => {
    if (!sortConfig.key) return data;

    return [...data].sort((a, b) => {
      const aVal = a[sortConfig.key!];
      const bVal = b[sortConfig.key!];

      if (aVal === bVal) return 0;

      const comparison = aVal < bVal ? -1 : 1;
      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });
  }, [data, sortConfig]);

  const requestSort = useCallback((key: keyof T) => {
    setSortConfig((current) => {
      if (current.key === key) {
        return {
          key,
          direction: current.direction === 'asc' ? 'desc' : 'asc',
        };
      }
      return { key, direction: 'asc' };
    });
  }, []);

  return {
    sortedData,
    sortConfig,
    requestSort,
  };
}

/**
 * useTableSearch hook - implements client-side search filtering
 * Debounced to avoid performance hits on large datasets
 */
export function useTableSearch<T>(
  data: T[],
  searchableKeys: (keyof T)[],
  debounceMs = 300
) {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      setDebouncedTerm(searchTerm);
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [searchTerm, debounceMs]);

  const filteredData = useMemo(() => {
    if (!debouncedTerm) return data;

    const lowerTerm = debouncedTerm.toLowerCase();
    return data.filter((item) =>
      searchableKeys.some((key) => {
        const value = item[key];
        if (typeof value === 'string') {
          return value.toLowerCase().includes(lowerTerm);
        }
        if (typeof value === 'number') {
          return value.toString().includes(lowerTerm);
        }
        return false;
      })
    );
  }, [data, debouncedTerm, searchableKeys]);

  return {
    filteredData,
    searchTerm,
    setSearchTerm,
    isSearching: searchTerm !== debouncedTerm,
  };
}

/**
 * useOptimizedTable hook - combines all optimizations
 * Main hook for rendering large transaction tables efficiently
 */
export function useOptimizedTable<T>(
  data: T[],
  options: {
    pageSize?: number;
    sortKey?: keyof T;
    searchKeys?: (keyof T)[];
    virtualization?: VirtualizationConfig;
  } = {}
) {
  const {
    pageSize = 50,
    sortKey,
    searchKeys = [],
    virtualization,
  } = options;

  // Step 1: Search/Filter
  const {
    filteredData,
    searchTerm,
    setSearchTerm,
    isSearching,
  } = useTableSearch(data, searchKeys);

  // Step 2: Sort
  const { sortedData, sortConfig, requestSort } = useTableSort(
    filteredData,
    sortKey
  );

  // Step 3: Paginate (or virtualize)
  const pagination = usePagination(sortedData, pageSize);

  // Step 4: Virtualization (optional, for extremely large datasets)
  const virtual = virtualization
    ? useVirtualization(pagination.paginatedData, virtualization)
    : null;

  return {
    // Data
    data: virtual?.virtualData.map((v) => v.item) || pagination.paginatedData,
    totalRecords: data.length,
    filteredRecords: filteredData.length,
    
    // Search
    searchTerm,
    setSearchTerm,
    isSearching,
    
    // Sort
    sortConfig,
    requestSort,
    
    // Pagination
    pagination,
    
    // Virtualization
    virtual,
  };
}

/**
 * Performance monitoring utility
 * Logs render performance metrics in development
 */
export function useTablePerformance(label: string, dataLength: number) {
  const renderCount = useRef(0);
  const startTime = useRef(Date.now());

  useEffect(() => {
    renderCount.current += 1;
    const duration = Date.now() - startTime.current;

    if (process.env.NODE_ENV === 'development' && renderCount.current % 10 === 0) {
      console.log(`[${label}] Render #${renderCount.current}, ${dataLength} items, ${duration}ms`);
    }

    startTime.current = Date.now();
  });

  return { renderCount: renderCount.current };
}

/**
 * Memoization helper for table row rendering
 * Prevents re-renders of unchanged rows
 */
export function createMemoizedRow<T>(
  Component: React.ComponentType<{ item: T; index: number }>
): React.ComponentType<{ item: T; index: number }> {
  return React.memo(Component, (prevProps, nextProps) => {
    return (
      prevProps.index === nextProps.index &&
      JSON.stringify(prevProps.item) === JSON.stringify(nextProps.item)
    );
  });
}
