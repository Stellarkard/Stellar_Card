// Root loading state — shown while the root layout's server components
// stream in. Uses the PageLoadingSkeleton for a branded spin state.

import { PageLoadingSkeleton } from './components/LoadingState';

export default function RootLoading() {
  return <PageLoadingSkeleton />;
}
