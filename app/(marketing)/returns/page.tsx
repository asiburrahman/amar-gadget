import { InformationPage } from "@/components/content/information-page";
import { informationMetadata } from "@/lib/site-information";
export const generateMetadata = () => informationMetadata("returns");
export default function ReturnsPage() { return <InformationPage slug="returns" />; }
