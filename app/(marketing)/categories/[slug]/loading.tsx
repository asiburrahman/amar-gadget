import { LoadingSpinner } from "@/components/ui/loading-spinner";

export default function Loading() {
  return (
    <LoadingSpinner
      message="Loading Category Products..."
      subMessage="Finding matching gadgets in this collection"
    />
  );
}
