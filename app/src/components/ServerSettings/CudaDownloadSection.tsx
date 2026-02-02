import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react';
import { relaunch } from '@tauri-apps/plugin-process';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ModelProgress } from './ModelProgress';
import { apiClient } from '@/lib/api/client';
import { useServerStore } from '@/stores/serverStore';
import { toast } from '@/components/ui/use-toast';
import { usePlatform } from '@/platform/PlatformContext';
import { useServerHealth } from '@/lib/hooks/useServer';

export function CudaDownloadSection() {
  const platform = usePlatform();
  const serverUrl = useServerStore((state) => state.serverUrl);
  const { data: health } = useServerHealth();
  const [downloadingCuda, setDownloadingCuda] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Platform checks
  const isWindows = navigator.userAgent.includes('Windows');
  const gpuAvailable = health?.gpu_available ?? false;

  // Only show this section on Windows + Tauri + GPU available
  if (!platform.metadata.isTauri || !isWindows || !gpuAvailable) {
    return null;
  }

  // Query CUDA status
  const { data: cudaStatus, refetch } = useQuery({
    queryKey: ['cudaStatus'],
    queryFn: () => apiClient.getCudaStatus(),
    enabled: isWindows && platform.metadata.isTauri && gpuAvailable,
    retry: false,
  });

  // Handle download trigger
  const handleDownload = async () => {
    try {
      setDownloadError(null);
      await apiClient.triggerCudaDownload();
      setDownloadingCuda(true);
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Failed to start download');
    }
  };

  // Handle retry
  const handleRetry = () => {
    setDownloadError(null);
    handleDownload();
  };

  // Monitor download progress and auto-restart on completion
  useEffect(() => {
    if (!downloadingCuda || !serverUrl) return;

    const eventSource = new EventSource(`${serverUrl}/models/progress/cuda-binary`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.status === 'complete' && data.progress >= 100) {
          eventSource.close();
          setDownloadingCuda(false);

          // Show restart toast
          toast({
            title: 'CUDA Downloaded',
            description: 'Restarting app to enable GPU acceleration...',
          });

          // Restart after 2 seconds
          setTimeout(async () => {
            await relaunch();
          }, 2000);
        }

        if (data.status === 'error') {
          eventSource.close();
          setDownloadingCuda(false);
          setDownloadError(data.error || 'Download failed');
        }
      } catch (error) {
        console.error('Error parsing CUDA download progress:', error);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      setDownloadingCuda(false);
      setDownloadError('Connection to server lost');
    };

    return () => eventSource.close();
  }, [downloadingCuda, serverUrl]);

  if (!cudaStatus) {
    return null;
  }

  const { cuda_available, cuda_active, cuda_binary_size_mb } = cudaStatus;

  return (
    <Card>
      <CardHeader>
        <CardTitle>GPU Acceleration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status badges */}
        <div className="flex flex-wrap gap-2">
          <Badge variant={cuda_active ? 'default' : 'secondary'}>
            Mode: {cuda_active ? 'CUDA' : 'CPU'}
          </Badge>
          <Badge variant={gpuAvailable ? 'default' : 'secondary'}>
            GPU: {gpuAvailable ? 'Available' : 'Not Available'}
          </Badge>
        </div>

        {/* Already downloaded status */}
        {cuda_available && !downloadingCuda && (
          <Alert>
            <CheckCircle className="h-4 w-4" />
            <AlertDescription>
              CUDA support is active. GPU acceleration enabled.
            </AlertDescription>
          </Alert>
        )}

        {/* Download section - only show if not already downloaded */}
        {!cuda_available && !downloadError && !downloadingCuda && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Download CUDA support for 4-5x faster inference with your NVIDIA GPU
            </p>
            <Button onClick={handleDownload} className="w-full">
              Download CUDA Support ({cuda_binary_size_mb.toFixed(1)}GB)
            </Button>
          </div>
        )}

        {/* Progress display */}
        {downloadingCuda && (
          <div className="space-y-2">
            <ModelProgress
              modelName="cuda-binary"
              displayName="CUDA Server Binary"
              isDownloading={true}
            />
          </div>
        )}

        {/* Error with retry button */}
        {downloadError && (
          <div className="space-y-2">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{downloadError}</AlertDescription>
            </Alert>
            <Button onClick={handleRetry} variant="outline" className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry Download
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
