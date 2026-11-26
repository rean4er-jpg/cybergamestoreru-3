import { useEffect, useState, type SyntheticEvent } from 'react';
import { Gamepad2 } from 'lucide-react';

interface ResilientImageProps {
  src: string;
  alt: string;
  title?: string;
  className?: string;
  imgClassName?: string;
  fallbackTone?: string;
  mode?: 'smart' | 'contain' | 'cover';
}

export function ResilientImage({
  src,
  alt,
  title,
  className = '',
  imgClassName = '',
  fallbackTone = 'from-slate-800 to-slate-900',
  mode = 'smart',
}: ResilientImageProps) {
  const [hasError, setHasError] = useState(false);
  const [naturalRatio, setNaturalRatio] = useState<number | null>(null);

  useEffect(() => {
    setHasError(false);
    setNaturalRatio(null);
  }, [src]);

  if (hasError || !src) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex flex-col items-center justify-center bg-gradient-to-br ${fallbackTone} text-slate-200 p-6 text-center ${className}`}
      >
        <Gamepad2 className="w-8 h-8 mb-2 opacity-75" strokeWidth={1.5} />
        {title && <span className="text-sm font-medium tracking-tight opacity-90">{title}</span>}
      </div>
    );
  }

  const handleLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setNaturalRatio(img.naturalWidth / img.naturalHeight);
    }
  };

  // Show full uncropped artwork over ambient blurred backdrop whenever ratio differs from 4:3
  const useAmbientContain =
    mode === 'contain' ||
    (mode === 'smart' &&
      (naturalRatio === null || naturalRatio < 1.22 || naturalRatio > 1.5));

  if (useAmbientContain) {
    return (
      <div className={`relative w-full h-full overflow-hidden bg-neutral-900 ${className}`}>
        <img
          src={src}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className="absolute inset-0 w-full h-full object-cover blur-xl scale-115 opacity-55 brightness-75 pointer-events-none select-none"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-black/30 via-transparent to-black/15 pointer-events-none"
        />
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={handleLoad}
          onError={() => setHasError(true)}
          className={`relative z-[1] w-full h-full object-contain ${imgClassName}`}
        />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={handleLoad}
      onError={() => setHasError(true)}
      className={`w-full h-full object-cover ${className} ${imgClassName}`}
    />
  );
}
