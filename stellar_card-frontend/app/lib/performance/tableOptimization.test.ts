import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  usePagination,
  useTableSort,
  useTableSearch,
  useOptimizedTable,
} from './tableOptimization';

describe('tableOptimization', () => {
  const mockData = Array.from({ length: 100 }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
    value: i * 10,
    category: i % 3 === 0 ? 'A' : i % 3 === 1 ? 'B' : 'C',
  }));

  describe('usePagination', () => {
    it('should initialize with correct default values', () => {
      const { result } = renderHook(() => usePagination(mockData));

      expect(result.current.page).toBe(0);
      expect(result.current.pageSize).toBe(50);
      expect(result.current.total).toBe(100);
      expect(result.current.totalPages).toBe(2);
    });

    it('should paginate data correctly', () => {
      const { result } = renderHook(() => usePagination(mockData, 10));

      expect(result.current.paginatedData).toHaveLength(10);
      expect(result.current.paginatedData[0].id).toBe(0);
      expect(result.current.paginatedData[9].id).toBe(9);
    });

    it('should navigate to next page', () => {
      const { result } = renderHook(() => usePagination(mockData, 10));

      act(() => {
        result.current.nextPage();
      });

      expect(result.current.page).toBe(1);
      expect(result.current.paginatedData[0].id).toBe(10);
    });

    it('should navigate to previous page', () => {
      const { result } = renderHook(() => usePagination(mockData, 10));

      act(() => {
        result.current.nextPage();
        result.current.previousPage();
      });

      expect(result.current.page).toBe(0);
    });

    it('should go to specific page', () => {
      const { result } = renderHook(() => usePagination(mockData, 10));

      act(() => {
        result.current.goToPage(5);
      });

      expect(result.current.page).toBe(5);
      expect(result.current.paginatedData[0].id).toBe(50);
    });

    it('should change page size and reset to first page', () => {
      const { result } = renderHook(() => usePagination(mockData, 10));

      act(() => {
        result.current.nextPage();
        result.current.changePageSize(20);
      });

      expect(result.current.pageSize).toBe(20);
      expect(result.current.page).toBe(0);
      expect(result.current.paginatedData).toHaveLength(20);
    });

    it('should handle hasNextPage and hasPreviousPage correctly', () => {
      const { result } = renderHook(() => usePagination(mockData, 10));

      expect(result.current.hasNextPage).toBe(true);
      expect(result.current.hasPreviousPage).toBe(false);

      act(() => {
        result.current.goToPage(5);
      });

      expect(result.current.hasNextPage).toBe(true);
      expect(result.current.hasPreviousPage).toBe(true);
    });
  });

  describe('useTableSort', () => {
    it('should initialize without sorting', () => {
      const { result } = renderHook(() => useTableSort(mockData));

      expect(result.current.sortConfig.key).toBe(null);
      expect(result.current.sortedData).toEqual(mockData);
    });

    it('should sort data ascending by key', () => {
      const { result } = renderHook(() => useTableSort(mockData));

      act(() => {
        result.current.requestSort('value');
      });

      expect(result.current.sortConfig.key).toBe('value');
      expect(result.current.sortConfig.direction).toBe('asc');
      expect(result.current.sortedData[0].value).toBe(0);
      expect(result.current.sortedData[99].value).toBe(990);
    });

    it('should toggle sort direction on same key', () => {
      const { result } = renderHook(() => useTableSort(mockData));

      act(() => {
        result.current.requestSort('value');
      });

      act(() => {
        result.current.requestSort('value');
      });

      expect(result.current.sortConfig.direction).toBe('desc');
      expect(result.current.sortedData[0].value).toBe(990);
      expect(result.current.sortedData[99].value).toBe(0);
    });

    it('should reset to ascending when changing sort key', () => {
      const { result } = renderHook(() => useTableSort(mockData));

      act(() => {
        result.current.requestSort('value');
        result.current.requestSort('value'); // desc
        result.current.requestSort('id'); // reset to asc for new key
      });

      expect(result.current.sortConfig.key).toBe('id');
      expect(result.current.sortConfig.direction).toBe('asc');
    });
  });

  describe('useTableSearch', () => {
    it('should initialize with empty search term', () => {
      const { result } = renderHook(() =>
        useTableSearch(mockData, ['name', 'category'])
      );

      expect(result.current.searchTerm).toBe('');
      expect(result.current.filteredData).toEqual(mockData);
    });

    it('should filter data based on search term', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useTableSearch(mockData, ['name', 'category'], 100)
      );

      act(() => {
        result.current.setSearchTerm('Item 1');
      });

      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(result.current.filteredData.length).toBeGreaterThan(0);
      expect(result.current.filteredData.every((item) => item.name.includes('Item 1'))).toBe(true);

      vi.useRealTimers();
    });

    it('should be case insensitive', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useTableSearch(mockData, ['name'], 100)
      );

      act(() => {
        result.current.setSearchTerm('item 5');
      });

      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(result.current.filteredData.length).toBeGreaterThan(0);

      vi.useRealTimers();
    });

    it('should search across multiple keys', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useTableSearch(mockData, ['name', 'category'], 100)
      );

      act(() => {
        result.current.setSearchTerm('A');
      });

      act(() => {
        vi.advanceTimersByTime(150);
      });

      expect(result.current.filteredData.length).toBeGreaterThan(0);

      vi.useRealTimers();
    });
  });

  describe('useOptimizedTable', () => {
    it('should combine all optimizations', () => {
      const { result } = renderHook(() =>
        useOptimizedTable(mockData, {
          pageSize: 10,
          searchKeys: ['name'],
        })
      );

      expect(result.current.data).toHaveLength(10);
      expect(result.current.totalRecords).toBe(100);
      expect(result.current.pagination.page).toBe(0);
    });

    it('should handle search and pagination together', async () => {
      vi.useFakeTimers();
      const { result } = renderHook(() =>
        useOptimizedTable(mockData, {
          pageSize: 10,
          searchKeys: ['name'],
        })
      );

      act(() => {
        result.current.setSearchTerm('Item 1');
      });

      act(() => {
        vi.advanceTimersByTime(350);
      });

      expect(result.current.filteredRecords).toBeLessThan(100);
      expect(result.current.data.length).toBeLessThanOrEqual(10);

      vi.useRealTimers();
    });

    it('should handle sort and pagination together', () => {
      const { result } = renderHook(() =>
        useOptimizedTable(mockData, {
          pageSize: 10,
          sortKey: 'value',
        })
      );

      act(() => {
        result.current.requestSort('value');
      });

      expect(result.current.sortConfig.key).toBe('value');
      expect(result.current.data).toHaveLength(10);
      expect(result.current.data[0].value).toBe(0);
    });
  });
});
