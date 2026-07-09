import Image from "next/image";
import Link from "next/link";
import { H4 } from "@/components/ui/typography";

interface ProductCardProps {
  title: string;
  price: string;
  discountPrice?: string;
  imageUrl: string;
  href?: string;
}

export function ProductTypographyCard({
  title,
  price,
  discountPrice,
  imageUrl,
  href,
}: ProductCardProps) {
  const CardContent = (
    <>
      <div className="aspect-square relative w-full overflow-hidden rounded bg-muted">
        <Image
          src={imageUrl}
          alt={title}
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          className="object-cover transition-transform group-hover:scale-105"
        />
      </div>
      <H4 className="line-clamp-2 text-sm font-semibold tracking-tight min-h-[2.5rem]">
        {title || "Untitled Product"}
      </H4>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-bold tracking-tight text-primary font-sans">
          {price} BDT
        </span>
        {discountPrice && (
          <span className="text-xs line-through text-muted-foreground font-sans">
            {discountPrice} BDT
          </span>
        )}
      </div>
    </>
  );

  const containerClasses = "group relative flex flex-col gap-2 rounded-lg border p-4 bg-card text-card-foreground shadow-sm hover:shadow transition-shadow";

  if (href) {
    return (
      <Link href={href} className={containerClasses}>
        {CardContent}
      </Link>
    );
  }

  return (
    <div className={containerClasses}>
      {CardContent}
    </div>
  );
}
