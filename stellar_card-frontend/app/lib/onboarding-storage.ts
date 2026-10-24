/**
 * Onboarding Storage Utilities
 * 
 * Provides persistent storage for onboarding state with fallbacks:
 * - Tries localStorage first (most reliable)
 * - Falls back to sessionStorage if localStorage is unavailable
 * - Falls back to in-memory storage if both are unavailable
 * - Supports version tracking for onboarding migrations
 */

export interface OnboardingState {
  /** Whether onboarding has been completed */
  completed: boolean;
  /** Current step index (0-based) */
  currentStep: number;
  /** Timestamp of last update */
  lastUpdate: number;
  /** Version of onboarding flow for migration tracking */
  version: number;
  /** Custom user data */
  customData?: Record<string, unknown>;
}

export interface StorageOptions {
  /** Storage key prefix (default: 'onboarding') */
  keyPrefix?: string;
  /** Version of onboarding flow (default: 1) */
  version?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
}

class OnboardingStorage {
  private keyPrefix: string;
  private version: number;
  private debug: boolean;
  private memoryStore: Map<string, OnboardingState> = new Map();
  private storageType: 'localStorage' | 'sessionStorage' | 'memory' = 'memory';

  constructor(options: StorageOptions = {}) {
    this.keyPrefix = options.keyPrefix || 'onboarding';
    this.version = options.version || 1;
    this.debug = options.debug || false;

    // Detect available storage
    this.detectStorage();
  }

  /**
   * Detect which storage mechanism is available
   */
  private detectStorage(): void {
    try {
      if (typeof window === 'undefined') {
        this.storageType = 'memory';
        this.log('Server-side rendering detected, using memory storage');
        return;
      }

      // Try localStorage
      const testKey = `${this.keyPrefix}_test`;
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      this.storageType = 'localStorage';
      this.log('localStorage available');
    } catch (e) {
      try {
        // Try sessionStorage
        const testKey = `${this.keyPrefix}_test`;
        sessionStorage.setItem(testKey, '1');
        sessionStorage.removeItem(testKey);
        this.storageType = 'sessionStorage';
        this.log('localStorage unavailable, using sessionStorage');
      } catch {
        // Fall back to memory
        this.storageType = 'memory';
        this.log('Both localStorage and sessionStorage unavailable, using memory storage');
      }
    }
  }

  /**
   * Get the full storage key
   */
  private getKey(suffix: string): string {
    return `${this.keyPrefix}:${suffix}`;
  }

  /**
   * Get onboarding state
   */
  public getState(id: string = 'default'): OnboardingState | null {
    try {
      const key = this.getKey(id);

      if (this.storageType === 'memory') {
        return this.memoryStore.get(key) || null;
      }

      const storage = this.storageType === 'localStorage' ? localStorage : sessionStorage;
      const data = storage.getItem(key);

      if (!data) {
        this.log(`No state found for ${id}`);
        return null;
      }

      const state = JSON.parse(data) as OnboardingState;

      // Check for version mismatch (migration scenario)
      if (state.version !== this.version) {
        this.log(`Version mismatch for ${id}: stored=${state.version}, current=${this.version}`);
        return null; // Return null to trigger re-onboarding
      }

      this.log(`Retrieved state for ${id}:`, state);
      return state;
    } catch (error) {
      this.log(`Error reading state for ${id}:`, error);
      return null;
    }
  }

  /**
   * Set onboarding state
   */
  public setState(state: OnboardingState, id: string = 'default'): boolean {
    try {
      const key = this.getKey(id);
      const dataToStore = {
        ...state,
        version: this.version,
        lastUpdate: Date.now(),
      };

      if (this.storageType === 'memory') {
        this.memoryStore.set(key, dataToStore);
        this.log(`Stored state for ${id} in memory`);
        return true;
      }

      const storage = this.storageType === 'localStorage' ? localStorage : sessionStorage;
      storage.setItem(key, JSON.stringify(dataToStore));
      this.log(`Stored state for ${id} in ${this.storageType}`);
      return true;
    } catch (error) {
      this.log(`Error storing state for ${id}:`, error);
      return false;
    }
  }

  /**
   * Check if onboarding is completed
   */
  public isCompleted(id: string = 'default'): boolean {
    const state = this.getState(id);
    return state?.completed ?? false;
  }

  /**
   * Mark onboarding as completed
   */
  public markCompleted(id: string = 'default'): boolean {
    const state = this.getState(id) || {
      completed: false,
      currentStep: 0,
      version: this.version,
      lastUpdate: Date.now(),
    };

    return this.setState({
      ...state,
      completed: true,
      currentStep: 0,
    }, id);
  }

  /**
   * Save current step
   */
  public setCurrentStep(step: number, id: string = 'default'): boolean {
    const state = this.getState(id) || {
      completed: false,
      currentStep: 0,
      version: this.version,
      lastUpdate: Date.now(),
    };

    return this.setState({
      ...state,
      currentStep: step,
    }, id);
  }

  /**
   * Get current step
   */
  public getCurrentStep(id: string = 'default'): number {
    const state = this.getState(id);
    return state?.currentStep ?? 0;
  }

  /**
   * Reset onboarding state
   */
  public reset(id: string = 'default'): boolean {
    try {
      const key = this.getKey(id);

      if (this.storageType === 'memory') {
        this.memoryStore.delete(key);
        this.log(`Reset state for ${id} in memory`);
        return true;
      }

      const storage = this.storageType === 'localStorage' ? localStorage : sessionStorage;
      storage.removeItem(key);
      this.log(`Reset state for ${id} in ${this.storageType}`);
      return true;
    } catch (error) {
      this.log(`Error resetting state for ${id}:`, error);
      return false;
    }
  }

  /**
   * Reset all onboarding states
   */
  public resetAll(): boolean {
    try {
      if (this.storageType === 'memory') {
        this.memoryStore.clear();
        this.log('Reset all states in memory');
        return true;
      }

      const storage = this.storageType === 'localStorage' ? localStorage : sessionStorage;
      const keysToRemove: string[] = [];

      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(`${this.keyPrefix}:`)) {
          keysToRemove.push(key);
        }
      }

      keysToRemove.forEach((key) => storage.removeItem(key));
      this.log(`Reset ${keysToRemove.length} states in ${this.storageType}`);
      return true;
    } catch (error) {
      this.log('Error resetting all states:', error);
      return false;
    }
  }

  /**
   * Set custom data
   */
  public setCustomData(data: Record<string, unknown>, id: string = 'default'): boolean {
    const state = this.getState(id) || {
      completed: false,
      currentStep: 0,
      version: this.version,
      lastUpdate: Date.now(),
    };

    return this.setState({
      ...state,
      customData: { ...state.customData, ...data },
    }, id);
  }

  /**
   * Get custom data
   */
  public getCustomData(id: string = 'default'): Record<string, unknown> | null {
    const state = this.getState(id);
    return state?.customData || null;
  }

  /**
   * Get storage type
   */
  public getStorageType(): string {
    return this.storageType;
  }

  /**
   * Debug logging
   */
  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log('[OnboardingStorage]', ...args);
    }
  }

  /**
   * Export all states (for debugging)
   */
  public exportAll(): Record<string, OnboardingState> {
    const result: Record<string, OnboardingState> = {};

    if (this.storageType === 'memory') {
      this.memoryStore.forEach((value, key) => {
        result[key] = value;
      });
    } else {
      const storage = this.storageType === 'localStorage' ? localStorage : sessionStorage;
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(`${this.keyPrefix}:`)) {
          const data = storage.getItem(key);
          if (data) {
            result[key] = JSON.parse(data);
          }
        }
      }
    }

    return result;
  }
}

// Singleton instance
let instance: OnboardingStorage | null = null;

/**
 * Get or create the onboarding storage instance
 */
export function getOnboardingStorage(options?: StorageOptions): OnboardingStorage {
  if (!instance) {
    instance = new OnboardingStorage(options);
  }
  return instance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetOnboardingStorageInstance(): void {
  instance = null;
}
