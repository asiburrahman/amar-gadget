import { InformationPage } from "@/components/content/information-page";
import { informationMetadata } from "@/lib/site-information";
export const generateMetadata = () => informationMetadata("terms");
export default function TermsPage() { return <InformationPage slug="terms" />; }
