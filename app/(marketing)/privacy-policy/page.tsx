import { InformationPage } from "@/components/content/information-page";
import { informationMetadata } from "@/lib/site-information";
export const generateMetadata = () => informationMetadata("privacy-policy");
export default function PrivacyPolicyPage() { return <InformationPage slug="privacy-policy" />; }
