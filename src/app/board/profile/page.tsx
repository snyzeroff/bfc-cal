import { PageHeader } from "@/components/ui";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/crypto";
import { requireUser } from "@/lib/auth/session";
import { ROLE_DESCRIPTION, ROLE_LABEL } from "@/lib/permissions";
import { getProfile } from "@/lib/profile";
import { formatDateTime, formatDayYear } from "@/lib/time";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "My profile" };

export default async function ProfilePage() {
  const user = await requireUser();
  const profile = await getProfile(user.id);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="My profile" />
      <ProfileForm
        profile={{
          name: profile.name,
          email: profile.email,
          roleLabel: ROLE_LABEL[profile.role],
          roleDescription: ROLE_DESCRIPTION[profile.role],
          memberSince: formatDayYear(profile.createdAt),
          lastSignIn: profile.lastLoginAt ? formatDateTime(profile.lastLoginAt) : null,
          activeSessions: profile.activeSessions,
        }}
        minPasswordLength={MIN_PASSWORD_LENGTH}
      />
    </div>
  );
}
