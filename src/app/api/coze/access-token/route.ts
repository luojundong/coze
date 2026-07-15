import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth } from '@/lib/auth-guard';
import { getValidCozeToken, getCozeToken } from '@/lib/coze-token';

export async function GET(request: NextRequest) {
  try {
    const { userId, error: authError } = await verifyAuth(request);
    if (authError) return authError;

    // Check if user has a Coze token
    const tokenData = await getCozeToken(userId);
    if (!tokenData?.accessToken) {
      return NextResponse.json({ connected: false, access_token: null });
    }

    // Get a valid (possibly refreshed) access token
    const accessToken = await getValidCozeToken(userId);
    return NextResponse.json({
      connected: true,
      access_token: accessToken,
    });
  } catch {
    return NextResponse.json({ connected: false, access_token: null });
  }
}
