import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface GameMapErrorBoundaryProps {
  children: ReactNode;
}

interface GameMapErrorBoundaryState {
  hasError: boolean;
}

export default class GameMapErrorBoundary extends Component<
  GameMapErrorBoundaryProps,
  GameMapErrorBoundaryState
> {
  state: GameMapErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): GameMapErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[GameMapErrorBoundary] Map render failed', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-lg border-2 border-border bg-card px-6 py-8 text-center">
          <p className="text-lg font-black text-foreground">Map unavailable</p>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            The map crashed while rendering, but the rest of the round is still available.
          </p>
          <Button
            onClick={() => window.location.reload()}
            variant="outline"
            className="mt-4"
          >
            Reload map
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
