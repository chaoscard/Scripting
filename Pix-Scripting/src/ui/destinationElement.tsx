import { NavigationDestination } from "scripting"
import { renderDestination } from "../store/routeNavigation"

export const destinationElement = (
  <NavigationDestination>
    {(path: string) => renderDestination(path)}
  </NavigationDestination>
)
